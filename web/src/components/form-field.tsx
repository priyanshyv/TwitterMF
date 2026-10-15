import { Label } from '@/components/ui/label';

export function FormField(props: {
  id: string;
  label: string;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.children}
      {props.error ? (
        <p id={`${props.id}-error`} className="text-sm text-destructive">
          {props.error}
        </p>
      ) : (
        props.hint
      )}
    </div>
  );
}
