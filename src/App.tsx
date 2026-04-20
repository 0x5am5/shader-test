import { ShaderCanvas } from './components/ShaderCanvas'

const assetMap = import.meta.glob('./assets/media/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const assets = Object.values(assetMap)

export default function App() {
  return <ShaderCanvas assets={assets} />
}
