interface RowActionsProps {
  onEdit?: () => void;
  onDelete?: () => void;
  disabled?: boolean;
  editLabel?: string;
  deleteLabel?: string;
}

export function RowActions({ onEdit, onDelete, disabled = false, editLabel = 'Editar', deleteLabel = 'Excluir' }: RowActionsProps) {
  if (!onEdit && !onDelete) {
    return null;
  }

  return (
    <div className="flex gap-2">
      {onEdit && (
        <button
          type="button"
          disabled={disabled}
          onClick={onEdit}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {editLabel}
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          disabled={disabled}
          onClick={onDelete}
          className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deleteLabel}
        </button>
      )}
    </div>
  );
}
