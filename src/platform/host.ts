export type Platform = 'macos' | 'ios' | 'linux' | 'windows' | 'android' | 'web'

declare function fiotpHostInvoke(method: string, payload: string): string

function hasNativeHost(): boolean {
  return typeof fiotpHostInvoke === 'function'
}

function parse(raw: string): { ok: boolean; data?: any; error?: string; code?: string } {
  const result = JSON.parse(raw) as { ok: boolean; data?: any; error?: string; code?: string }
  if (!result.ok) throw new Error(result.error || 'Native işlem başarısız oldu.')
  return result
}

type UiSuccess = (raw: string) => void
type UiFailure = (error: Error) => void

export class PlatformHost {
  readonly available = hasNativeHost()
  readonly platform: Platform = this.readPlatform()

  private readPlatform(): Platform {
    if (!hasNativeHost()) return 'web'
    try {
      const result = parse(fiotpHostInvoke('platform.info', '{}'))
      return result.data?.platform ?? 'macos'
    } catch {
      // Older native builds predate platform.info and are macOS-only.
      return 'macos'
    }
  }

  invoke(method: string, payload: Record<string, unknown> = {}): string {
    if (!hasNativeHost()) throw new Error('Bu işlem yerel FiOTP uygulamasında kullanılabilir.')
    const raw = fiotpHostInvoke(method, JSON.stringify(payload))
    parse(raw)
    return raw
  }

  invokeAsync(method: string, payload: Record<string, unknown>, onSuccess: UiSuccess, onFailure: UiFailure): void {
    if (this.platform !== 'ios' && this.platform !== 'android') {
      try {
        onSuccess(this.invoke(method, payload))
      } catch (error) {
        onFailure(error as Error)
      }
      return
    }

    try {
      const started = parse(this.invoke('ui.start', { method, payload: JSON.stringify(payload) }))
      const id = started.data?.id
      if (!id) throw new Error('Arayüz işlem kimliği alınamadı.')
      const poll = () => {
        try {
          const result = parse(this.invoke('ui.poll', { id }))
          if (result.data?.pending) {
            setTimeout(poll, 100)
            return
          }
          if (!result.data?.response) throw new Error('Arayüz işlemi sonuç döndürmedi.')
          parse(result.data.response)
          onSuccess(result.data.response)
        } catch (error) {
          onFailure(error as Error)
        }
      }
      setTimeout(poll, 100)
    } catch (error) {
      onFailure(error as Error)
    }
  }

  copy(text: string): void {
    if (this.available) {
      this.invoke('clipboard.copy', { text })
      return
    }
    const nav = (globalThis as unknown as { navigator?: { clipboard?: { writeText(v: string): void } } }).navigator
    nav?.clipboard?.writeText(text)
  }
}

export const platformHost = new PlatformHost()
