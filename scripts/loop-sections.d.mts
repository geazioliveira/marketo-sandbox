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
