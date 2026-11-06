import api from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'

const FALLBACK_CONFIG = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] }
let configPromise

export async function getInternalCallRtcConfig() {
  if (!configPromise) {
    configPromise = api.get(API_ENDPOINTS.internalTickets.callConfig)
      .then(({ data }) => Array.isArray(data?.iceServers) && data.iceServers.length ? { iceServers: data.iceServers } : FALLBACK_CONFIG)
      .catch(() => FALLBACK_CONFIG)
  }
  return configPromise
}

export function waitForInternalCallIce(peer, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (peer.iceGatheringState === 'complete') return resolve()
    let timer
    const done = () => {
      if (peer.iceGatheringState !== 'complete') return
      peer.removeEventListener('icegatheringstatechange', done)
      clearTimeout(timer)
      resolve()
    }
    peer.addEventListener('icegatheringstatechange', done)
    timer = setTimeout(() => { peer.removeEventListener('icegatheringstatechange', done); resolve() }, timeoutMs)
  })
}
