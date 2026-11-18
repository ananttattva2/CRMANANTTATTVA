import React, { useLayoutEffect, useRef, useState } from 'react'
import { ResponsiveContainer as RechartsResponsiveContainer } from 'recharts'

export default function SafeResponsiveContainer(props) {
  const containerRef = useRef(null)
  const [hasDimensions, setHasDimensions] = useState(false)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const updateSize = () => {
      const { width, height } = container.getBoundingClientRect()
      setHasDimensions(width > 0 && height > 0)
    }

    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }

    const observer = new ResizeObserver(updateSize)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const wrapperStyle = {
    width: props.width ?? '100%',
    height: props.height ?? '100%',
    minWidth: 0,
    minHeight: 0,
    ...props.style
  }

  return (
    <div ref={containerRef} className={props.className} style={wrapperStyle}>
      {hasDimensions && <RechartsResponsiveContainer minWidth={0} {...props} />}
    </div>
  )
}
