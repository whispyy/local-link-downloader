// Build-time constant — rendered once, never changes at runtime.
export default function VersionBadge() {
  return (
    <a
      href="#/usage"
      className="fixed bottom-2 right-3 text-[10px] font-mono text-th-text-faint select-none opacity-50 hover:opacity-100 transition-opacity no-underline"
      title={`Version: ${__COMMIT_HASH__}`}
    >
      {__COMMIT_HASH__}
    </a>
  );
}
