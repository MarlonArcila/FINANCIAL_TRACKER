import { useId } from "react";

interface MoneyInputProps {
  label: string;
  value: string;
  currency: string;
  onChange(value: string): void;
  required?: boolean;
  min?: number;
  help?: string;
}

export function MoneyInput({ label, value, currency, onChange, required, min = 0, help }: MoneyInputProps) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <div className="money-input">
        <span>{currency}</span>
        <input
          id={id}
          inputMode="decimal"
          type="number"
          min={min}
          step="any"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
        />
      </div>
      {help ? <small>{help}</small> : null}
    </label>
  );
}
