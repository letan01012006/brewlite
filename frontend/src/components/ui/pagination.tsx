export function Pagination({
  page,
  totalPages,
  onChange,
  disabled = false,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  disabled?: boolean;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav
      aria-label="Phân trang"
      className="flex items-center justify-center gap-6 py-6 text-sm text-stone-700 dark:text-stone-300"
    >
      <button
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
        className="disabled:opacity-40 hover:text-amber-600 dark:hover:text-amber-400 cursor-pointer disabled:cursor-not-allowed"
      >
        ← Trang trước
      </button>
      <span className="font-medium">
        Trang {page}/{totalPages}
      </span>
      <button
        disabled={disabled || page >= totalPages}
        onClick={() => onChange(page + 1)}
        className="disabled:opacity-40 hover:text-amber-600 dark:hover:text-amber-400 cursor-pointer disabled:cursor-not-allowed"
      >
        Trang sau →
      </button>
    </nav>
  );
}
