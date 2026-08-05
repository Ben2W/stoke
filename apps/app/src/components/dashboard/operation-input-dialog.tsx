"use client";

import type { ManagedWorkspace } from "@usestoke/managed";
import { Play, X } from "lucide-react";
import { useState } from "react";
import {
  humanizeOperationInput,
  initialOperationInput,
  isRecord,
  isScalar,
  operationInputProperties,
  operationRequiredFields,
  parseOperationInput,
  type OperationInput,
} from "./operation-input.ts";

type WorkspaceOperation = ManagedWorkspace["operations"][number];

export function OperationInputDialog({ error, onClose, onSubmit, operation, pending }: {
  error?: string;
  onClose(): void;
  onSubmit(input: OperationInput): void;
  operation: WorkspaceOperation;
  pending: boolean;
}) {
  const properties = operationInputProperties(operation.inputSchema);
  const required = operationRequiredFields(operation.inputSchema);
  const [values, setValues] = useState<Record<string, unknown>>(() => initialOperationInput(properties));
  const [validationError, setValidationError] = useState<string>();

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 px-4 backdrop-blur-[2px]" onMouseDown={(event) => event.currentTarget === event.target && !pending && onClose()} role="presentation">
      <section aria-labelledby="operation-input-title" aria-modal="true" className="w-full max-w-lg overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl" role="dialog">
        <header className="flex items-start justify-between border-b border-zinc-100 px-6 py-5">
          <div>
            <h2 className="text-base font-semibold" id="operation-input-title">{operation.title ?? operation.id}</h2>
            <p className="mt-1 text-sm text-zinc-500">{operation.description ?? "Configure this operation."}</p>
          </div>
          <button aria-label="Close" className="grid size-8 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100" disabled={pending} onClick={onClose} type="button"><X size={17} /></button>
        </header>
        <form className="space-y-5 p-6" onSubmit={(event) => {
          event.preventDefault();
          try {
            setValidationError(undefined);
            onSubmit(parseOperationInput(properties, required, values));
          } catch (cause) {
            setValidationError(cause instanceof Error ? cause.message : String(cause));
          }
        }}>
          {Object.entries(properties).map(([name, rawProperty], index) => {
            const property = isRecord(rawProperty) ? rawProperty : {};
            return <OperationField autoFocus={index === 0} key={name} name={name} onChange={(value) => setValues((current) => ({ ...current, [name]: value }))} property={property} required={required.has(name)} value={values[name]} />;
          })}
          {validationError || error ? <p className="text-xs text-red-600" role="alert">{validationError ?? error}</p> : null}
          <div className="flex justify-end gap-2 border-t border-zinc-100 pt-5">
            <button className="h-9 rounded-md border border-zinc-200 px-4 text-xs font-medium hover:bg-zinc-50" disabled={pending} onClick={onClose} type="button">Cancel</button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-4 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50" disabled={pending} type="submit">
              {pending ? <span className="size-3 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Play size={12} />}
              {pending ? "Starting…" : "Run"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function OperationField({ autoFocus, name, onChange, property, required, value }: {
  autoFocus: boolean;
  name: string;
  onChange(value: unknown): void;
  property: Record<string, unknown>;
  required: boolean;
  value: unknown;
}) {
  const label = typeof property.title === "string" ? property.title : humanizeOperationInput(name);
  const description = typeof property.description === "string" ? property.description : undefined;
  const id = `operation-input-${name}`;
  if (property.type === "boolean") {
    return <label className="flex items-start gap-3" htmlFor={id}><input checked={value === true} className="mt-0.5 size-4 rounded border-zinc-300" id={id} onChange={(event) => onChange(event.target.checked)} type="checkbox" /><span><span className="block text-xs font-medium text-zinc-700">{label}</span>{description ? <span className="mt-1 block text-xs leading-5 text-zinc-500">{description}</span> : null}</span></label>;
  }
  const options = Array.isArray(property.enum) ? property.enum.filter(isScalar) : [];
  const inputClass = "mt-2 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-100";
  return (
    <label className="block text-xs font-medium text-zinc-700" htmlFor={id}>
      {label}{required ? <span className="text-red-500"> *</span> : null}
      {options.length ? (
        <select autoFocus={autoFocus} className={inputClass} id={id} onChange={(event) => onChange(event.target.value)} required={required} value={String(value ?? "")}>
          <option disabled={required} value="">{required ? "Select a value" : "Not set"}</option>
          {options.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
        </select>
      ) : (
        <input autoFocus={autoFocus} className={inputClass} id={id} onChange={(event) => onChange(event.target.value)} required={required} step={property.type === "integer" ? "1" : "any"} type={property.type === "number" || property.type === "integer" ? "number" : "text"} value={String(value ?? "")} />
      )}
      {description ? <span className="mt-1.5 block text-xs font-normal leading-5 text-zinc-500">{description}</span> : null}
    </label>
  );
}
