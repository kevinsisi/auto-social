import { NoAvailableKeyError, type KeyPool } from '@kevinsisi/ai-core/key-pool'
import { planPreferredKeys, StepRunner, type PlannedStepAssignment } from '@kevinsisi/ai-core/step-orchestration'
import { buildSystemInstruction } from './prompt-builder.js'
import { buildClassifyPrompt, parseClassify } from './steps/classify.js'
import { buildDraftPrompt, parseDraft } from './steps/draft.js'
import { buildMemePrompt, parseMeme } from './steps/meme.js'
import { buildScorePrompt, parseScore } from './steps/score.js'
import { buildSponsoredDetectPrompt, parseSponsoredDetect } from './steps/sponsored-detect.js'
import { DEFAULT_VOICE_PROFILE, type PipelineResult, type SocialPipelineOptions, type SourceCandidateInput, type SponsoredResult, type TextGenerator, type VoiceProfile } from './types.js'

const STEP_DEFINITIONS = [
  { id: 'classify', name: 'Classify candidate', allowSharedFallback: true },
  { id: 'sponsored', name: 'Sponsored detect', allowSharedFallback: true },
  { id: 'score', name: 'Score candidate', allowSharedFallback: true },
  { id: 'draft', name: 'Draft variants', allowSharedFallback: true },
  { id: 'meme', name: 'Meme prompt', allowSharedFallback: true }
] as const

export class SocialPipeline {
  private readonly options: Required<SocialPipelineOptions>

  constructor(
    private readonly pool: KeyPool,
    private readonly generator: TextGenerator,
    private readonly profile: VoiceProfile = DEFAULT_VOICE_PROFILE,
    options: SocialPipelineOptions = {}
  ) {
    this.options = {
      runSponsored: options.runSponsored ?? false,
      runMeme: options.runMeme ?? true
    }
  }

  async run(candidate: SourceCandidateInput): Promise<PipelineResult> {
    const assignments = await planPreferredKeys(this.pool, STEP_DEFINITIONS)
    const runner = new StepRunner(this.pool)
    const analysisSystem = buildSystemInstruction(this.profile, 'analysis')
    const voiceSystem = buildSystemInstruction(this.profile, 'voice')

    try {
      const classify = parseClassify(await this.generate(runner, 'classify', analysisSystem, buildClassifyPrompt(candidate), assignments))
      if (classify.sensitivity === 'high' && this.profile.noGoZones.includes(classify.topic)) {
        return {
          classify,
          sponsored: null,
          score: { engagementWorth: 0, risk: 'high', timeliness: 'cold', shouldDraft: false, reason: 'topic matched voice no-go zone' },
          draft: null,
          meme: null,
          shortCircuited: true,
          plannedKeys: toPlannedKeys(assignments)
        }
      }

      let sponsored: SponsoredResult | null = null
      if (this.options.runSponsored) {
        sponsored = parseSponsoredDetect(await this.generate(runner, 'sponsored', analysisSystem, buildSponsoredDetectPrompt(candidate), assignments))
      }

      const score = parseScore(await this.generate(runner, 'score', analysisSystem, buildScorePrompt(candidate, classify), assignments))

      if (!score.shouldDraft) {
        return {
          classify,
          sponsored,
          score,
          draft: null,
          meme: null,
          shortCircuited: true,
          plannedKeys: toPlannedKeys(assignments)
        }
      }

      const draft = parseDraft(await this.generate(runner, 'draft', voiceSystem, buildDraftPrompt(candidate, classify, score, this.profile), assignments))
      const safeDraft = {
        variants: draft.variants.filter((variant) => isVariantSafe(variant.text, this.profile.noGoZones))
      }
      if (safeDraft.variants.length === 0) {
        throw new Error('pipeline_blocked: all draft variants violated voice no-go zones')
      }
      const meme = this.options.runMeme
        ? parseMeme(await this.generate(runner, 'meme', voiceSystem, buildMemePrompt(candidate, safeDraft), assignments))
        : null

      return {
        classify,
        sponsored,
        score,
        draft: safeDraft,
        meme,
        shortCircuited: false,
        plannedKeys: toPlannedKeys(assignments)
      }
    } catch (error) {
      if (error instanceof NoAvailableKeyError) {
        throw new Error('pipeline_blocked: no available Gemini key')
      }
      throw error
    }
  }

  private async generate(
    runner: StepRunner,
    stepId: string,
    systemInstruction: string,
    prompt: string,
    assignments: PlannedStepAssignment[]
  ) {
    const assignment = assignments.find((item) => item.stepId === stepId)
    const result = await runner.runStep({
      id: stepId,
      name: assignment?.stepName ?? stepId,
      preferredKey: assignment?.preferredKey ?? null,
      allowSharedFallback: true,
      run: async (apiKey) => this.generator({ stepId, systemInstruction, prompt, preferredKey: apiKey })
    })
    return result.value
  }
}

function toPlannedKeys(assignments: PlannedStepAssignment[]) {
  return assignments.map(({ stepId, preferredKey, sharedFallbackRequired }) => ({ stepId, preferredKey, sharedFallbackRequired }))
}

function isVariantSafe(text: string, noGoZones: string[]) {
  const normalized = text.toLowerCase()
  return !noGoZones.some((zone) => normalized.includes(zone.toLowerCase()))
}
