"use client";

// A submit button that asks for confirmation before firing its server action.
// The action is passed in from a server component; hidden inputs carry the ids.
export default function ConfirmButton({
  action,
  hidden,
  confirmText,
  className,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hidden: Record<string, string | number>;
  confirmText: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}
