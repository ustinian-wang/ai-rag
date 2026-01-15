import fs from 'fs/promises'
import path from 'path'

export interface ProjectConfig {
  id: string
  name: string
  path: string
  indexed: boolean
  lastIndexed: string | null
}

export interface Config {
  version: string
  projects: ProjectConfig[]
  ollama: {
    baseUrl: string
    embeddingModel: string
    timeout: number
  }
  storage: {
    dataDir: string
    lanceDir: string
    cacheDir: string
  }
}

const CONFIG_PATH = path.join(process.cwd(), '.ai-rag-data', 'config.json')

export async function loadConfig(): Promise<Config> {
  const content = await fs.readFile(CONFIG_PATH, 'utf-8')
  return JSON.parse(content)
}

export async function saveConfig(config: Config): Promise<void> {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

export async function addProject(name: string, projectPath: string): Promise<ProjectConfig> {
  const config = await loadConfig()

  const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  const project: ProjectConfig = {
    id,
    name,
    path: projectPath,
    indexed: false,
    lastIndexed: null,
  }

  config.projects.push(project)
  await saveConfig(config)

  return project
}

export async function getProjects(): Promise<ProjectConfig[]> {
  const config = await loadConfig()
  return config.projects
}

export async function getProject(id: string): Promise<ProjectConfig | null> {
  const config = await loadConfig()
  return config.projects.find(p => p.id === id) || null
}

export async function updateProject(id: string, updates: Partial<ProjectConfig>): Promise<void> {
  const config = await loadConfig()
  const index = config.projects.findIndex(p => p.id === id)
  if (index !== -1) {
    config.projects[index] = { ...config.projects[index], ...updates }
    await saveConfig(config)
  }
}
