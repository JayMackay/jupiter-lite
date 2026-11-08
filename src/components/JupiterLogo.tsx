/** Shared emoji-style mark for Workspace, Chats and the voice controls. */
export default function JupiterLogo({ size = 64 }: { size?: number; animated?: boolean; tone?: 'pink' | 'black' }) {
  return <img className="jupiter-logo" src={'/assets/jupiter.png'} width={size} height={size} alt="" aria-hidden="true" draggable={false} style={{ display: 'block', flexShrink: 0, objectFit: 'contain' }} />
}
