import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import { Check, Paperclip, Send, Stamp as StampIcon, X } from "lucide-react";
import type { Agent, Approval, Message } from "@losperitos/protocol";
import { AwayCard } from "./away";
import type { Ctx } from "./context";
import { Markdown } from "./preview";
import { T, fromCore } from "./strings";
import { Emblem, I, clock, perito, sealKind, sealText } from "./ui";

/**
 * The correspondence thread with its composer. It is the same component in
 * the side panel that stays open on every screen and on the Correspondence
 * screen, so a question can be answered or a request sealed wherever you are.
 */

interface Pending {
  /** Name the core stored the file under. */
  name: string;
  label: string;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** What follows "@" while a mention is being typed at the start of the message. */
const mentionOf = (text: string) => /^@(\S*)$/.exec(text)?.[1]?.toLowerCase() ?? null;

export function Chat({ ctx, onPickAgent }: { ctx: Ctx; onPickAgent?(agentId: string): void }) {
  const { agents, messages, approvals, actions, bureau } = ctx;
  const [text, setText] = useState("");
  const [toId, setToId] = useState<string | null>(null);
  const [files, setFiles] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const lead = agents.find((agent) => agent.role === "lead");
  // The recipient falls back to the lead if the chosen perito is gone.
  const recipient = agents.find((agent) => agent.id === toId) ?? lead;
  const who = (agent: Agent) => perito(agent, agents).who;
  const name = (id: string | null) => {
    const agent = agents.find((a) => a.id === id);
    return agent ? who(agent) : null;
  };
  const spent = ctx.state.budgets[bureau.id]?.level === "exhausted";

  // Seal requests are part of the conversation, in the order they were raised.
  const items = [
    ...messages.map((message) => ({ at: message.createdAt, message, approval: null as Approval | null })),
    ...approvals.map((approval) => ({ at: approval.createdAt, message: null as Message | null, approval })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [items.length]);

  const fragment = mentionOf(text);
  const suggestions =
    fragment === null ? [] : agents.filter((agent) => who(agent).toLowerCase().replace(/\s+/g, "").includes(fragment));
  const pick = (agent: Agent) => {
    setToId(agent.id);
    setText("");
    input.current?.focus();
  };

  const attach = async (list: Iterable<File>) => {
    setError(null);
    for (const file of list) {
      try {
        const stored = await actions.upload(bureau.id, file.name || "pasted-image.png", await toBase64(file));
        setFiles((current) => [...current, { name: stored, label: file.name || T.chat.pasted }]);
      } catch (err) {
        setError(`${file.name}: ${(err as Error).message}`);
      }
    }
  };
  const onPaste = (event: ClipboardEvent) => {
    const pasted = [...event.clipboardData.files];
    if (pasted.length) {
      event.preventDefault();
      void attach(pasted);
    }
  };
  const onDrop = (event: DragEvent) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    void attach(event.dataTransfer.files);
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (suggestions.length && fragment !== null) return pick(suggestions[0]!);
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await actions.send(
        bureau.id,
        text.trim(),
        recipient?.id ?? null,
        files.map((file) => file.name),
      );
      setText("");
      setFiles([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat">
      <AwayCard ctx={ctx} />
      <div className="chat-log" ref={log}>
        {items.length === 0 && <p className="muted chat-empty">{T.mail.empty}</p>}
        {items.map(({ at, message, approval }) => {
          const agentId = message ? (message.author.kind === "agent" ? message.author.agentId : null) : approval!.agentId;
          const agent = agents.find((a) => a.id === agentId);
          const view = agent ? perito(agent, agents) : null;
          const from = view?.who ?? (message?.author.kind === "user" ? T.mail.you : T.mail.bureau);
          const to = approval || message?.question ? T.mail.you : (name(message!.toAgentId) ?? T.mail.panel);
          return (
            <div
              key={(message ?? approval)!.id}
              className={`msg ${agent && onPickAgent ? "clickable" : ""}`}
              onClick={() => agent && onPickAgent?.(agent.id)}
            >
              {view ? (
                <Emblem role={view.role} mono={view.mono} size={26} />
              ) : (
                <Emblem role="other" mono={message?.author.kind === "user" ? "YOU" : "LP"} size={26} />
              )}
              <div className="grow">
                <div className="msg-head">
                  <b>{from}</b> → {to} · <span className="mono">{clock(at)}</span>
                </div>
                {message?.author.kind === "agent" ? (
                  <div className="msg-body msg-md">
                    <Markdown source={fromCore(message.body)} breaks />
                  </div>
                ) : (
                  <div className="msg-body">{message ? (message.author.kind === "system" ? fromCore(message.body) : message.body) : sealText(approval!).title}</div>
                )}
                {message?.attachments?.length ? (
                  <div className="msg-files">
                    {message.attachments.map((file) => (
                      <span key={file} className="file-chip">
                        <I icon={Paperclip} size={12} />
                        {file.replace(/^[0-9a-f]{8}-/, "")}
                      </span>
                    ))}
                  </div>
                ) : null}
                {message?.question && <QuestionReply ctx={ctx} message={message} onError={setError} />}
                {approval && <SealReply ctx={ctx} approval={approval} onError={setError} />}
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="err chat-error">{error}</p>}

      <form className="chat-composer" onSubmit={send} onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
        <div className="chat-to" role="group" aria-label={T.chat.to}>
          <span className="muted">{T.chat.to}</span>
          {agents
            .filter((agent) => agent.status !== "stopped" || agent.role === "lead")
            .map((agent) => (
              <button
                key={agent.id}
                type="button"
                className="to-chip"
                aria-pressed={recipient?.id === agent.id}
                onClick={() => setToId(agent.id)}
              >
                {who(agent)}
              </button>
            ))}
        </div>
        {files.length > 0 && (
          <div className="msg-files">
            {files.map((file) => (
              <span key={file.name} className="file-chip">
                <I icon={Paperclip} size={12} />
                {file.label}
                <button
                  type="button"
                  aria-label={T.chat.remove(file.label)}
                  onClick={() => setFiles((current) => current.filter((other) => other.name !== file.name))}
                >
                  <I icon={X} size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="chat-input">
          {suggestions.length > 0 && (
            <div className="mention-menu" role="listbox">
              {suggestions.map((agent, index) => (
                <button key={agent.id} type="button" role="option" aria-selected={index === 0} onClick={() => pick(agent)}>
                  @{who(agent)}
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={input}
            className="input"
            rows={2}
            value={text}
            disabled={spent}
            onChange={(event) => setText(event.target.value)}
            onPaste={onPaste}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={spent ? T.bench.spent : T.chat.placeholder(recipient ? who(recipient) : T.perito.lead)}
            aria-label={T.chat.placeholder(recipient ? who(recipient) : T.perito.lead)}
          />
        </div>
        <div className="row">
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files) void attach(event.target.files);
              event.target.value = "";
            }}
          />
          <button type="button" className="btn btn-ghost" disabled={spent} onClick={() => picker.current?.click()}>
            <I icon={Paperclip} />
            {T.chat.attach}
          </button>
          <span className="grow muted chat-hint">{T.chat.hint}</span>
          <button className="btn btn-secondary" disabled={spent || busy || !text.trim()}>
            <I icon={Send} />
            {T.mail.send}
          </button>
        </div>
      </form>
    </div>
  );
}

/** A question answered where it was asked. */
function QuestionReply({ ctx, message, onError }: { ctx: Ctx; message: Message; onError(text: string): void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(false);
  if (message.question!.answer !== null) {
    return (
      <div className="msg-actions muted">
        <I icon={Check} />
        {T.mail.answered(message.question!.answer)}
      </div>
    );
  }
  const answer = (value: string) => {
    if (!value.trim() || busy) return;
    setBusy(true);
    ctx.actions.answer(message.id, value.trim(), remember).then(
      () => ctx.note(T.awaiting.answerSent),
      (err: Error) => {
        setBusy(false);
        onError(err.message);
      },
    );
  };
  return (
    <div className="reply-card" onClick={(event) => event.stopPropagation()}>
      <div className="msg-actions">
        {message.question!.options.map((option) => (
          <button key={option} className="btn btn-act" disabled={busy} onClick={() => answer(option)}>
            {option}
            {option === message.question!.recommended && <span className="suggested">★ {T.awaiting.recommended}</span>}
          </button>
        ))}
      </div>
      <label className="remember">
        <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
        {T.awaiting.remember}
      </label>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          answer(text);
        }}
      >
        <input
          className="input grow"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={T.awaiting.ownWords}
          aria-label={T.awaiting.ownWords}
        />
        <button className="btn btn-secondary" disabled={busy || !text.trim()}>
          {T.awaiting.send}
        </button>
      </form>
    </div>
  );
}

/** A seal request sealed where it was raised; the full card is one click away. */
function SealReply({ ctx, approval, onError }: { ctx: Ctx; approval: Approval; onError(text: string): void }) {
  const [busy, setBusy] = useState(false);
  if (approval.status !== "pending") {
    return (
      <div className="msg-actions muted">
        <I icon={Check} />
        {approval.status === "approved" ? T.mail.sealed : T.mail.declined}
      </div>
    );
  }
  const seal = () => {
    setBusy(true);
    ctx.actions.decideApproval(approval.id, "approved").catch((err: Error) => {
      setBusy(false);
      onError(err.message);
    });
  };
  return (
    <div className="reply-card" onClick={(event) => event.stopPropagation()}>
      <p className={`rev ${approval.reversible ? "" : "no"}`}>
        {T.seal.toastLine(approval.reversible, approval.steps.length, sealKind(ctx.bureau, approval))}
      </p>
      <div className="msg-actions">
        <button className="btn btn-primary" disabled={busy} onClick={seal}>
          <I icon={StampIcon} />
          {T.seal.seal}
        </button>
        <button className="btn btn-ghost" onClick={() => ctx.go({ screen: "awaiting", id: approval.id })}>
          {T.seal.details}
        </button>
      </div>
    </div>
  );
}
