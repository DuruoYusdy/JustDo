export interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  identity: string;
  model: string;
  icon: string;
  skillIds: string[];
  enabled: boolean;
  deletedAt?: number;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}
