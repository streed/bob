import express from 'express';
import { DatabaseService } from '../database/database.js';

export function createDatabaseRoutes(db: DatabaseService) {
  const router = express.Router();

  // Get all tables in the database
  router.get('/tables', async (req, res) => {
    try {
      const tables = await db.getAllTables();
      res.json(tables);
    } catch (error) {
      console.error('Error getting tables:', error);
      res.status(500).json({ error: 'Failed to get tables' });
    }
  });

  // Get table schema
  router.get('/tables/:tableName/schema', async (req, res) => {
    try {
      const { tableName } = req.params;
      const schema = await db.getTableSchema(tableName);
      res.json(schema);
    } catch (error) {
      console.error('Error getting table schema:', error);
      res.status(500).json({ error: 'Failed to get table schema' });
    }
  });

  // Get table data with pagination
  router.get('/tables/:tableName/data', async (req, res) => {
    try {
      const { tableName } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = (page - 1) * limit;

      const data = await db.getTableData(tableName, limit, offset);
      const count = await db.getTableCount(tableName);
      
      res.json({
        data,
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      });
    } catch (error) {
      console.error('Error getting table data:', error);
      res.status(500).json({ error: 'Failed to get table data' });
    }
  });

  // Execute raw SQL query (READ ONLY for safety)
  router.post('/query', async (req, res) => {
    try {
      const { sql } = req.body;
      
      if (!sql) {
        return res.status(400).json({ error: 'SQL query is required' });
      }

      // Only allow SELECT queries for safety
      const trimmedSql = sql.trim().toLowerCase();
      if (!trimmedSql.startsWith('select')) {
        return res.status(400).json({ 
          error: 'Only SELECT queries are allowed for safety. Use the specific endpoints for modifications.' 
        });
      }

      const result = await db.executeQuery(sql);
      res.json(result);
    } catch (error) {
      console.error('Error executing query:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to execute query' });
    }
  });

  // Delete specific rows (with confirmation)
  router.delete('/tables/:tableName/rows', async (req, res) => {
    try {
      const { tableName } = req.params;
      const { whereClause, confirm } = req.body;
      
      if (!confirm) {
        return res.status(400).json({ error: 'Confirmation required for delete operations' });
      }

      if (!whereClause) {
        return res.status(400).json({ error: 'WHERE clause is required for delete operations' });
      }

      const affectedRows = await db.deleteRows(tableName, whereClause);
      res.json({ message: `Deleted ${affectedRows} rows from ${tableName}`, affectedRows });
    } catch (error) {
      console.error('Error deleting rows:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete rows' });
    }
  });

  // Update specific rows (with confirmation)
  router.put('/tables/:tableName/rows', async (req, res) => {
    try {
      const { tableName } = req.params;
      const { setClause, whereClause, confirm } = req.body;
      
      if (!confirm) {
        return res.status(400).json({ error: 'Confirmation required for update operations' });
      }

      if (!setClause || !whereClause) {
        return res.status(400).json({ error: 'SET and WHERE clauses are required for update operations' });
      }

      const affectedRows = await db.updateRows(tableName, setClause, whereClause);
      res.json({ message: `Updated ${affectedRows} rows in ${tableName}`, affectedRows });
    } catch (error) {
      console.error('Error updating rows:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update rows' });
    }
  });

  return router;
}