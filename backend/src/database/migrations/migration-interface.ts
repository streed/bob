export interface Migration {
  id: number;
  name: string;
  description: string;
  up: (db: any) => Promise<void>;
  down: (db: any) => Promise<void>;
}