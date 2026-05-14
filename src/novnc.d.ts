declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: { shared?: boolean })
    background: string
    clipViewport: boolean
    compressionLevel: number
    focusOnClick: boolean
    qualityLevel: number
    resizeSession: boolean
    scaleViewport: boolean
    viewOnly: boolean
    blur(): void
    disconnect(): void
    focus(): void
  }
}
