interface HelpHintProps {
  text: string
}

export default function HelpHint({ text }: HelpHintProps) {
  return (
    <button
      type="button"
      aria-label={text}
      title={text}
      onClick={event => event.preventDefault()}
      style={{
        width: '18px',
        height: '18px',
        borderRadius: '999px',
        border: '1px solid var(--border-color)',
        background: 'rgba(255,255,255,0.04)',
        color: 'var(--text-secondary)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.72rem',
        fontWeight: 700,
        cursor: 'help',
        flexShrink: 0,
        padding: 0,
      }}
    >
      ?
    </button>
  )
}
