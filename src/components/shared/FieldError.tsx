type FieldErrorProps = {
  message?: string | null;
};

export function FieldError({ message }: FieldErrorProps) {
  if (!message) return null;

  return (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {message}
    </p>
  );
}
