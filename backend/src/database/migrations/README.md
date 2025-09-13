# Database Migrations

This directory contains database migration files for Bob. Migrations allow you to version and manage changes to the database schema over time.

## Migration System

The migration system provides:
- **Versioned schema changes**: Each migration has a unique ID and timestamp
- **Rollback support**: Ability to undo migrations 
- **Transaction safety**: Each migration runs in a transaction
- **Dependency tracking**: Migrations run in order and track what's been applied

## File Naming Convention

Migration files follow this pattern:
```
{id}_{name}.ts
```

Examples:
- `001_initial_schema.ts` - Initial database schema
- `002_add_user_preferences.ts` - Add user preferences table
- `003_modify_instances_table.ts` - Modify claude_instances table

## Migration Structure

Each migration file exports a default object implementing the `Migration` interface:

```typescript
import { Migration } from './migration-interface.js';
import { promisify } from 'util';

const migration: Migration = {
  id: 2,
  name: '002_example_migration',
  description: 'Description of what this migration does',

  async up(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));
    // Forward migration logic
    await run('ALTER TABLE repositories ADD COLUMN new_field TEXT');
  },

  async down(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));
    // Rollback logic
    await run('ALTER TABLE repositories DROP COLUMN new_field');
  }
};

export default migration;
```

## CLI Commands

### Check Migration Status
```bash
npm run migrate:status
```
Shows which migrations are applied and which are pending.

### Run Pending Migrations
```bash
npm run migrate:up
```
Runs all pending migrations in order.

### Rollback Last Migration
```bash
npm run migrate:down
```
Rolls back the most recently applied migration.

### Reset Database
```bash
npm run migrate:reset
```
Rolls back ALL migrations (destructive operation).

### Create New Migration
```bash
npm run migrate:create "add user preferences"
```
Creates a new migration file with the given name.

## Best Practices

### 1. Always Write Rollbacks
Every `up()` migration should have a corresponding `down()` rollback:

```typescript
async up(db: any): Promise<void> {
  await run('CREATE TABLE new_table (id INTEGER PRIMARY KEY)');
}

async down(db: any): Promise<void> {
  await run('DROP TABLE new_table');
}
```

### 2. Use Transactions
The migration runner automatically wraps each migration in a transaction, but you can use explicit transactions for complex operations:

```typescript
async up(db: any): Promise<void> {
  const run = promisify(db.run.bind(db));
  
  await run('BEGIN TRANSACTION');
  try {
    await run('ALTER TABLE repositories ADD COLUMN temp_field TEXT');
    await run('UPDATE repositories SET temp_field = "default_value"');
    await run('ALTER TABLE repositories DROP COLUMN old_field');
    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }
}
```

### 3. Test Your Migrations
Before deploying:
1. Test the migration: `npm run migrate:up`
2. Test the rollback: `npm run migrate:down`
3. Test running it again: `npm run migrate:up`

### 4. Be Careful with Data
When modifying columns that contain data:

```typescript
async up(db: any): Promise<void> {
  const run = promisify(db.run.bind(db));
  
  // Add new column
  await run('ALTER TABLE repositories ADD COLUMN new_status TEXT DEFAULT "active"');
  
  // Migrate existing data
  await run('UPDATE repositories SET new_status = "active" WHERE old_status = 1');
  await run('UPDATE repositories SET new_status = "inactive" WHERE old_status = 0');
  
  // Drop old column (SQLite doesn't support DROP COLUMN directly)
  // You may need to recreate the table
}
```

### 5. Incremental IDs
Migration IDs should be incremental integers. The system automatically suggests the next available ID when creating migrations.

## Troubleshooting

### Migration Failed
If a migration fails, it's automatically rolled back. Check the error message and fix the migration file, then try again.

### Out of Order Migrations
Migrations must run in order. If you have:
- 001 (applied)
- 003 (pending)
- 002 (pending)

You need to run migration 002 before 003.

### Rollback Issues
If a rollback fails, you may need to manually fix the database state or create a new migration to correct the issue.

## Migration History

The `migrations` table tracks which migrations have been applied:

```sql
SELECT * FROM migrations ORDER BY applied_at DESC;
```

This shows all applied migrations with their timestamps.