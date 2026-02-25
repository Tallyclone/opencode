import { createEffect, createMemo, Show, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"

import { DataProvider } from "@opencode-ai/ui/context"
import type { QuestionAnswer } from "@opencode-ai/sdk/v2"
import { decode64 } from "@/utils/base64"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"
import { findLast } from "@opencode-ai/util/array"
import { extractPromptFromParts } from "@/utils/prompt"

function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const params = useParams()
  const navigate = useNavigate()
  const sync = useSync()
  const sdk = useSDK()
  const command = useCommand()

  const withSessionMessage = (sessionID: string, messageID: string) => {
    const info = sync.session.get(sessionID)
    const messages = (sync.data.message[sessionID] ?? []).filter((m) => m.role === "user")
    return { info, messages, message: messages.find((m) => m.id === messageID) }
  }

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      onPermissionRespond={(input: {
        sessionID: string
        permissionID: string
        response: "once" | "always" | "reject"
      }) => sdk.client.permission.respond(input)}
      onQuestionReply={(input: { requestID: string; answers: QuestionAnswer[] }) => sdk.client.question.reply(input)}
      onQuestionReject={(input: { requestID: string }) => sdk.client.question.reject(input)}
      onNavigateToSession={(sessionID: string) => navigate(`/${params.dir}/session/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/${params.dir}/session/${sessionID}`}
      onMessageSearch={() => command.trigger("file.open")}
      onMessageCopy={async ({ sessionID, messageID }) => {
        const parts = sync.data.part[messageID] ?? []
        const text = extractPromptFromParts(parts, { directory: sdk.directory })
          .map((part) => (part.type === "text" ? part.content : ""))
          .join("")
          .trim()
        if (!text) return
        await navigator.clipboard.writeText(text)
      }}
      onMessageFork={({ sessionID, messageID }) => {
        sdk.client.session
          .fork({ sessionID, messageID })
          .then((result) => {
            const id = result.data?.id
            if (!id) return
            navigate(`/${params.dir}/session/${id}`)
          })
          .catch(() => {})
      }}
      onMessageRevert={async ({ sessionID, messageID }) => {
        const { info, messages, message } = withSessionMessage(sessionID, messageID)
        if (!message) return
        if (sync.data.session_status[sessionID]?.type !== "idle") {
          await sdk.client.session.abort({ sessionID }).catch(() => {})
        }
        const revert = info?.revert?.messageID
        const target = revert ? findLast(messages, (x) => x.id < revert && x.id <= messageID) : message
        if (!target) return
        await sdk.client.session.revert({ sessionID, messageID: target.id })
      }}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const navigate = useNavigate()
  const language = useLanguage()
  const [store, setStore] = createStore({ invalid: "" })
  const directory = createMemo(() => {
    return decode64(params.dir) ?? ""
  })

  createEffect(() => {
    if (!params.dir) return
    if (directory()) return
    if (store.invalid === params.dir) return
    setStore("invalid", params.dir)
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/", { replace: true })
  })
  return (
    <Show when={directory()}>
      <SDKProvider directory={directory}>
        <SyncProvider>
          <DirectoryDataProvider directory={directory()}>{props.children}</DirectoryDataProvider>
        </SyncProvider>
      </SDKProvider>
    </Show>
  )
}
