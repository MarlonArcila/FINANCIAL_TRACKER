import { useState } from "react";

import { createCategory } from "../lib/data";
import type { Category } from "../lib/types";
import { Notice } from "./Notice";

interface CategoryKindOption {
  value: Category["kind"];
  label: string;
}

export function InlineCategoryCreator({
  options,
  defaultKind,
  onCreated,
  onCancel,
}: {
  options: CategoryKindOption[];
  defaultKind: Category["kind"];
  onCreated(category: Category): Promise<void> | void;
  onCancel(): void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Category["kind"]>(defaultKind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const normalizedName = name.trim();
    if (!normalizedName) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createCategory({ name: normalizedName, kind });
      setName("");
      await onCreated(created);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible crear la categoría.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-category-creator">
      <div className="inline-category-heading">
        <div>
          <strong>Crear categoría</strong>
          <small>Se guardará también en Ajustes → Categorías.</small>
        </div>
        <button className="text-button" type="button" onClick={onCancel}>Cancelar</button>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="inline-category-fields">
        <label className="field">
          <span>Nombre</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }}
            maxLength={80}
            required
            autoFocus
            placeholder="Ej. Transporte, Viaje, Dividendos…"
          />
        </label>
        <label className="field">
          <span>Aplica a</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as Category["kind"])}>
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <button className="secondary-button" type="button" disabled={busy || !name.trim()} onClick={() => void submit()}>{busy ? "Creando…" : "Guardar categoría"}</button>
    </div>
  );
}
