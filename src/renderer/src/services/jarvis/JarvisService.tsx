import { createContext, useContext } from 'react'
import JarvisService from './JarvisService'

const JarvisServiceContext = createContext<JarvisService | null>(null)

export function JarvisServiceProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const service = new JarvisService()

  return <JarvisServiceContext.Provider value={service}>{children}</JarvisServiceContext.Provider>
}

export function useJarvisService(): JarvisService {
  const service = useContext(JarvisServiceContext)
  if (!service) {
    throw new Error('useJarvisService must be used within JarvisServiceProvider')
  }
  return service
}
