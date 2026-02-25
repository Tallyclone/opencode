import type {
  Message,
  Session,
  Part,
  FileDiff,
  SessionStatus,
  PermissionRequest,
  QuestionRequest,
  QuestionAnswer,
  ProviderListResponse,
} from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"

type Data = {
  provider?: ProviderListResponse
  session: Session[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: FileDiff[]
  }
  session_diff_preload?: {
    [sessionID: string]: PreloadMultiFileDiffResult<any>[]
  }
  permission?: {
    [sessionID: string]: PermissionRequest[]
  }
  question?: {
    [sessionID: string]: QuestionRequest[]
  }
  message: {
    [sessionID: string]: Message[]
  }
  part: {
    [messageID: string]: Part[]
  }
}

export type PermissionRespondFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
}) => void

export type QuestionReplyFn = (input: { requestID: string; answers: QuestionAnswer[] }) => void

export type QuestionRejectFn = (input: { requestID: string }) => void

export type NavigateToSessionFn = (sessionID: string) => void

export type SessionHrefFn = (sessionID: string) => string
export type SessionActionFn = (input: { sessionID: string; messageID: string }) => void

export type DataContext = {
  readonly store: Data
  readonly directory: string
  respondToPermission?: PermissionRespondFn
  replyToQuestion?: QuestionReplyFn
  rejectQuestion?: QuestionRejectFn
  navigateToSession?: NavigateToSessionFn
  sessionHref?: SessionHrefFn
  messageSearch?: SessionActionFn
  messageRevert?: SessionActionFn
  messageCopy?: SessionActionFn
  messageFork?: SessionActionFn
}

export const { use: useData, provider: DataProvider } = createSimpleContext<
  DataContext,
  {
    data: Data
    directory: string
    onPermissionRespond?: PermissionRespondFn
    onQuestionReply?: QuestionReplyFn
    onQuestionReject?: QuestionRejectFn
    onNavigateToSession?: NavigateToSessionFn
    onSessionHref?: SessionHrefFn
    onMessageSearch?: SessionActionFn
    onMessageRevert?: SessionActionFn
    onMessageCopy?: SessionActionFn
    onMessageFork?: SessionActionFn
  }
>({
  name: "Data",
  init: (props) => {
    return {
      get store() {
        return props.data
      },
      get directory() {
        return props.directory
      },
      respondToPermission: props.onPermissionRespond,
      replyToQuestion: props.onQuestionReply,
      rejectQuestion: props.onQuestionReject,
      navigateToSession: props.onNavigateToSession,
      sessionHref: props.onSessionHref,
      messageSearch: props.onMessageSearch,
      messageRevert: props.onMessageRevert,
      messageCopy: props.onMessageCopy,
      messageFork: props.onMessageFork,
    }
  },
})
