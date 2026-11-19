'use client'

// EngagedEvent: sends one Vercel Analytics custom event, "engaged" {via}, once per tab
// session on the first trusted wheel/touch/key input or 3rd pointer move after the page
// has been visible for 3s. Headless crawlers rarely produce trusted input, so visitors
// with "engaged" are the trusted-traffic count. Never sent under automation (webdriver).

import { useEffect } from 'react'
import { track } from '@vercel/analytics'

export function EngagedEvent() {
  useEffect(() => {
    const send = (name: string, props: Record<string, string>) => {
      try {
        track(name, props)
      } catch {
        /* analytics must never break the page */
      }
    }

    // engaged {via}: once per tab session, the first sign of a real person.
    // Headless crawlers that run JS rarely produce trusted input, so
    // "visitors with engaged" is the trusted-traffic count.
    const ENGAGED_KEY = 'ae_engaged'
    let engagedDone = false
    try {
      engagedDone = sessionStorage.getItem(ENGAGED_KEY) === '1'
    } catch {
      /* storage blocked: fall back to once per page load */
    }
    let visibleMs = 0
    let visibleSince = document.visibilityState === 'visible' ? performance.now() : 0
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (!visibleSince) visibleSince = performance.now()
      } else if (visibleSince) {
        visibleMs += performance.now() - visibleSince
        visibleSince = 0
      }
    }
    const visibleFor = () => visibleMs + (visibleSince ? performance.now() - visibleSince : 0)
    const HUMAN_EVENTS = ['pointermove', 'wheel', 'touchstart', 'keydown'] as const
    let moves = 0
    const onHuman = (e: Event) => {
      if (engagedDone || !e.isTrusted || navigator.webdriver) return
      if (e.type === 'pointermove' && ++moves < 3) return
      if (visibleFor() < 3000) return
      engagedDone = true
      try {
        sessionStorage.setItem(ENGAGED_KEY, '1')
      } catch {
        /* ignore */
      }
      const via = e.type === 'keydown' ? 'key' : e.type === 'touchstart' ? 'touch' : e.type === 'wheel' ? 'wheel' : 'pointer'
      send('engaged', { via })
      for (const t of HUMAN_EVENTS) window.removeEventListener(t, onHuman, { capture: true })
    }
    if (!engagedDone) {
      for (const t of HUMAN_EVENTS) window.addEventListener(t, onHuman, { capture: true, passive: true })
      document.addEventListener('visibilitychange', onVisibility)
    }

    return () => {
      for (const t of HUMAN_EVENTS) window.removeEventListener(t, onHuman, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
  return null
}

export default EngagedEvent
