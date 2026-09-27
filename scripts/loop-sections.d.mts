// Types for scripts/loop-sections.mjs, so the TypeScript specs can import the
// loop's contracts under `tsc --noEmit`. Declarations only: every value lives
// in the .mjs, and test/scripts/loop-sections.spec.ts fails when an export is
// added there without a declaration here.

export declare const ownerRule: string

// Branches

export declare const branchPrefixes: readonly string[]
export declare const branchCategory: ReadonlyMap<string, string>
export declare const branchPattern: RegExp
export declare const branchShapes: string

export interface ParsedBranch {
  prefix: string
  issue: number
  slug: string
}

export declare function parseBranch(
  branch: string | null | undefined,
): ParsedBranch | null
export declare function issueFromBranch(
  branch: string | null | undefined,
): number | null

// Labels

export type Kind = 'bug' | 'enhancement'

export declare const categoryLabels: readonly string[]
export declare const stateLabels: readonly string[]
export declare const readyLabel: string
export declare const agentCreateStateLabels: readonly string[]
export declare const agentPlanLabelTransition: Readonly<{
  from: 'needs-triage'
  to: 'ready-for-human'
}>

export declare function kindOf(labelNames: readonly string[]): {
  kind: Kind | null
  found: string[]
}

// Issue sections

export interface RequiredSection {
  heading: string
  why: string
}

export interface Section {
  title: string
  level: number
  content: string
}

export declare const featureSections: readonly RequiredSection[]
export declare const bugSections: readonly RequiredSection[]
export declare const optionalSections: readonly string[]
export declare const alternativeHeadings: ReadonlyMap<string, readonly string[]>
export declare const emptyFormAnswer: string

export declare function sectionsFor(
  kind: Kind | string | null | undefined,
): readonly RequiredSection[]
export declare function foldHeading(text: unknown): string
export declare function matchesHeading(found: string, required: string): boolean
export declare function parseSections(
  markdown: string | null | undefined,
): Section[]
export declare function hasContent(content: string | null | undefined): boolean
export declare function countCriteria(
  content: string | null | undefined,
): number
export declare function checkSections(
  planText: string | null | undefined,
  kind: Kind | string | null | undefined,
): { missing: string[]; empty: string[]; sections: Section[] }
export declare function findSection(
  planText: string | null | undefined,
  required: string,
): Section | null
export declare function criteriaSection(
  planText: string | null | undefined,
): string
export declare function branchSectionFor(
  kind: Kind | string | null | undefined,
): string
export declare function planCitesBranch(
  planText: string | null | undefined,
  branch: string,
  kind: Kind | string | null | undefined,
): { heading: string; section: boolean; cited: boolean }

// Stacks (#31)

export interface SlicePosition {
  index: number
  count: number
  first: boolean
  last: boolean
  below: string | null
  lower: string[]
  upper: string[]
}

export declare const stackSection: string
export declare const stackSliceLabel: string
export declare const prSizeLimit: number

export declare function stackOf(planText: string | null | undefined): {
  declared: boolean
  branches: string[]
  problems: string[]
}
export declare function slicePosition(
  branches: readonly string[] | null | undefined,
  branch: string,
): SlicePosition | null

// Plan, Approve, withdrawal

export interface Actor {
  __typename?: string
  login?: string
}

export interface IssueComment {
  body: string
  createdAt: string
  lastEditedAt?: string | null
  author?: Actor | null
}

export interface TimelineEvent {
  __typename: string
  createdAt: string
  actor?: Actor | null
  label?: { name: string } | null
}

export type ApproveCode =
  | 'ok'
  | 'none'
  | 'withdrawn'
  | 'not-owner'
  | 'no-words'
  | 'before-reopen'
  | 'ambiguous-approve'
  | 'revised'
  | 'body-edited'
  | 'comment-edited'
  | 'comment-deleted'
  | 'label-missing'
  | 'label-not-owner'
  | 'label-before-reopen'
  | 'label-before-approve'

export declare const planHeading: RegExp
export declare const approveHeading: RegExp
export declare const withdrawHeading: RegExp
export declare const approveLikeHeading: RegExp

export type CommentOpening = 'withdraw' | 'approve' | 'approve-like' | 'plan'

export declare function commentOpening(
  body: string | null | undefined,
): CommentOpening | null

export declare function headAndRest(body: string | null | undefined): {
  head: string
  rest: string
}

export declare function currentPlan<
  C extends { body: string; createdAt: string },
>(input: {
  body: string | null | undefined
  comments?: readonly C[]
}): { source: 'body' | 'comment'; text: string; comment: C | null }

export declare function approveState(input: {
  issue?: { lastEditedAt?: string | null }
  comments?: readonly IssueComment[]
  events?: readonly TimelineEvent[]
  ownerLogin: string
}): {
  ok: boolean
  code: ApproveCode
  detail: string
  approve: IssueComment | null
}

// Pull requests, checks, changelog

export declare const closesLine: RegExp
export interface RequiredCheck {
  workflow: string
  job: string
}

export declare const requiredChecks: readonly RequiredCheck[]
export declare function changelogHeadingFor(issue: number): RegExp
export declare const changelogHeading: RegExp

// The Copilot review and the review threads

export interface CopilotReviewer {
  typename: 'Bot'
  databaseId: number
  login: string
}

/** A review's author as GraphQL gives it; databaseId only on a Bot. */
export interface ReviewAuthor {
  __typename?: string
  login?: string
  databaseId?: number | null
}

export interface PullRequestReview {
  state?: string | null
  submittedAt?: string | null
  commit?: { oid?: string | null } | null
  author?: ReviewAuthor | null
  /** GraphQL's `body`; a review without it reads as failed (copilotFailedReview). */
  body?: string | null
}

/** A review request as GraphQL gives it; the reviewer's databaseId only on a Bot. */
export interface ReviewRequest {
  requestedReviewer?: ReviewAuthor | null
}

export interface ReviewThread {
  isResolved?: boolean | null
  isOutdated?: boolean | null
  path?: string | null
  line?: number | null
  comments?: {
    nodes?: readonly ({
      url?: string | null
      author?: { login?: string } | null
    } | null)[]
  } | null
}

export declare const copilotReviewer: CopilotReviewer
export declare const copilotRequestLogin: string
export declare const copilotHandle: string
export declare function shellWord(word: number | string): string
export declare function copilotRequestCommand(pr: number | string): string
export declare const copilotReviewStates: readonly string[]
export declare const reviewRuleSince: string
export declare const copilotFailedReview: RegExp
export declare function isCopilotReviewer(
  author: ReviewAuthor | null | undefined,
): boolean
export declare function copilotReviewOn<R extends PullRequestReview>(input: {
  reviews?: readonly (R | null)[] | null
  headRefOid: string | null | undefined
}): { ok: boolean; review: R | null; latest: R | null; failed: boolean }
export declare function copilotRequested(
  requests: readonly (ReviewRequest | null)[] | null | undefined,
): boolean
export declare function openThreads<T extends ReviewThread | null>(
  threads: readonly T[] | null | undefined,
): T[]

// Context files

export type ContextKind =
  | 'Project intent'
  | 'Feature'
  | 'Bug'
  | 'ADR'
  | 'Pattern'
  | 'Anti-pattern'
  | 'Agent'

export interface ContextKindRule {
  kind: ContextKind
  file: RegExp
  shape: string
  statuses: readonly string[]
}

export interface UntypedContextPath {
  file: RegExp
  shape: string
}

export declare const intentStatuses: readonly string[]
export declare const bugStatuses: readonly string[]
export declare const decisionStatuses: readonly string[]
export declare const knowledgeStatuses: readonly string[]
export declare const contextKinds: readonly ContextKindRule[]
export declare const untypedContextPaths: readonly UntypedContextPath[]
export declare function isUntypedContextFile(
  file: string | null | undefined,
): boolean
export declare function contextKindOf(file: string | null | undefined): {
  kind: ContextKind
  title: string
  statuses: readonly string[]
} | null
export declare const statusHeading: RegExp
export declare const statusLine: RegExp
export declare const statusDeclaration: RegExp
export declare const repositoryFileUrl: string

// The gate's steps and its cache

export type StepStatus = 'ok' | 'no' | 'unchecked' | 'skip'

export interface GateStep {
  id: string
  status: StepStatus
  blocks: boolean
  detail: string
}

export interface GateCache {
  schema: number
  repo?: string | null
  branch: string | null
  issue: number | null
  headSha?: string | null
  open: boolean
  verified: boolean
  steps?: GateStep[]
  checkedAt: string
}

export type GateState =
  | 'missing'
  | 'mismatch'
  | 'stale'
  | 'pending-plan'
  | 'unverified'
  | 'open'
  | 'closed'

export declare const stepIds: readonly string[]
export declare const loopSteps: readonly string[]
export declare const gateCacheFile: string
export declare const gateCacheSchema: number
export declare const gateTtlHours: number
export declare const planPendingPrefix: string

export declare function gateStatus(
  cache: GateCache | null | undefined,
  context: { branch: string; now?: number; pendingSince?: string | null },
): { state: GateState; cache?: GateCache }

// The audit of main and the issue-link refresh

export declare const auditBaseline: string
export declare const mainAuditWorkflowFile: string
export declare const auditTitlePrefix: string
export declare function auditTitleFor(sha: string | null | undefined): string
export declare const auditLabels: readonly string[]
export declare const auditCommitCap: number
export declare const auditIssueCap: number
export declare const auditLinkRetries: number
export declare const auditRetryDelayMs: number
export declare const auditJudgeStep: string
export declare const auditVerdictStep: string
export declare const auditVerdictFile: string
export declare const auditRunsRead: number
export declare const auditChecksPage: number
export declare const auditClosingPage: number
export declare const auditCron: string
export declare const issueLinkWorkflowFile: string
export declare const issueLinkEvent: string
export declare const issueLinkWorkflowPath: string
export declare const refreshPollMs: number
export declare const refreshWaitMs: number
export declare const skipCiTokens: readonly string[]
export declare const skipChecksTrailer: string

// The review signal, the PR refresh and the audit's review pages

export declare const reviewSignalWorkflow: string
export declare const reviewSignalWorkflowFile: string
export declare const issueLinkRefreshWorkflowFile: string
export declare function refreshPrCommand(pr: number | string): string
export declare function gateCiCommand(
  pr: number | string,
  branch: string,
): string
export declare const auditReviewPage: number
