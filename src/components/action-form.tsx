"use client";
import { useActionState } from "react";
export interface ActionState { ok: boolean; message: string }
export function ActionForm({ action, children }: { action: (state: ActionState, form: FormData) => Promise<ActionState>; children: React.ReactNode }) {
  const [state, submit, pending] = useActionState(action, { ok: false, message: "" });
  return <form action={submit} className="space-y-3"><fieldset disabled={pending} className="space-y-3">{children}</fieldset>
    {pending && <p role="status">Saving…</p>}{state.message && <p role={state.ok ? "status" : "alert"}>{state.message}</p>}</form>;
}
