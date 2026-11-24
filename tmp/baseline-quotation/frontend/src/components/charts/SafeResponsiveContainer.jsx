import React from 'react'
import { ResponsiveContainer as RechartsResponsiveContainer } from 'recharts'

export default function SafeResponsiveContainer(props) {
  return <RechartsResponsiveContainer minWidth={0} {...props} />
}
