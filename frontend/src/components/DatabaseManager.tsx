import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

interface TableData {
  data: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Column {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: any;
  pk: number;
}

export function DatabaseManager() {
  const navigate = useNavigate();
  const [isWarningAccepted, setIsWarningAccepted] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [tableSchema, setTableSchema] = useState<Column[]>([]);
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sqlQuery, setSqlQuery] = useState('');
  const [queryResult, setQueryResult] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (isWarningAccepted) {
      loadTables();
    }
  }, [isWarningAccepted]);

  useEffect(() => {
    if (selectedTable) {
      loadTableSchema();
      loadTableData(1);
      setSelectedRows(new Set()); // Clear row selection when table changes
    }
  }, [selectedTable]);

  const loadTables = async () => {
    try {
      setLoading(true);
      const tablesData = await api.getDatabaseTables();
      setTables(tablesData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tables');
    } finally {
      setLoading(false);
    }
  };

  const loadTableSchema = async () => {
    if (!selectedTable) return;
    
    try {
      const schema = await api.getTableSchema(selectedTable);
      setTableSchema(schema);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load table schema');
    }
  };

  const loadTableData = async (page: number) => {
    if (!selectedTable) return;
    
    try {
      setLoading(true);
      const data = await api.getTableData(selectedTable, page, 50);
      setTableData(data);
      setCurrentPage(page);
      setSelectedRows(new Set()); // Clear row selection when page changes
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load table data');
    } finally {
      setLoading(false);
    }
  };

  const executeQuery = async () => {
    if (!sqlQuery.trim()) return;

    try {
      setLoading(true);
      const result = await api.executeQuery(sqlQuery);
      setQueryResult(result);
      setError(null);
      setSuccess('Query executed successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute query');
      setQueryResult([]);
    } finally {
      setLoading(false);
    }
  };

  const deleteSelectedRows = async () => {
    const whereClause = prompt('Enter WHERE clause for DELETE operation (e.g., id = 123):');
    if (!whereClause || !selectedTable) return;

    const confirmed = confirm(`This will DELETE rows from ${selectedTable} WHERE ${whereClause}. This action cannot be undone. Continue?`);
    if (!confirmed) return;

    try {
      setLoading(true);
      const result = await api.deleteRows(selectedTable, whereClause, true);
      setSuccess(result.message);
      loadTableData(currentPage);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete rows');
    } finally {
      setLoading(false);
    }
  };

  const deleteSelectedRowsById = async () => {
    if (selectedRows.size === 0) {
      setError('No rows selected for deletion');
      return;
    }

    if (!tableData || !selectedTable) return;

    // Find the primary key column
    const pkColumn = tableSchema.find(col => col.pk === 1);
    if (!pkColumn) {
      setError('Cannot delete rows: No primary key found in table schema');
      return;
    }

    // Get the IDs of selected rows
    const selectedIds = Array.from(selectedRows).map(rowIndex => {
      const row = tableData.data[rowIndex];
      return row[pkColumn.name];
    });

    const confirmed = confirm(`This will DELETE ${selectedIds.length} selected rows from ${selectedTable}. This action cannot be undone. Continue?`);
    if (!confirmed) return;

    try {
      setLoading(true);
      const whereClause = `${pkColumn.name} IN (${selectedIds.map(id => typeof id === 'string' ? `'${id}'` : id).join(', ')})`;
      const result = await api.deleteRows(selectedTable, whereClause, true);
      setSuccess(result.message);
      setSelectedRows(new Set());
      loadTableData(currentPage);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete selected rows');
    } finally {
      setLoading(false);
    }
  };

  const toggleRowSelection = (rowIndex: number) => {
    const newSelection = new Set(selectedRows);
    if (newSelection.has(rowIndex)) {
      newSelection.delete(rowIndex);
    } else {
      newSelection.add(rowIndex);
    }
    setSelectedRows(newSelection);
  };

  const toggleAllRows = () => {
    if (!tableData) return;
    
    if (selectedRows.size === tableData.data.length) {
      // All rows are selected, deselect all
      setSelectedRows(new Set());
    } else {
      // Select all rows on current page
      const allRowIndices = new Set(tableData.data.map((_, index) => index));
      setSelectedRows(allRowIndices);
    }
  };

  const updateSelectedRows = async () => {
    const setClause = prompt('Enter SET clause for UPDATE operation (e.g., status = "stopped"):');
    if (!setClause) return;

    const whereClause = prompt('Enter WHERE clause for UPDATE operation (e.g., id = 123):');
    if (!whereClause || !selectedTable) return;

    const confirmed = confirm(`This will UPDATE ${selectedTable} SET ${setClause} WHERE ${whereClause}. Continue?`);
    if (!confirmed) return;

    try {
      setLoading(true);
      const result = await api.updateRows(selectedTable, setClause, whereClause, true);
      setSuccess(result.message);
      loadTableData(currentPage);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rows');
    } finally {
      setLoading(false);
    }
  };

  const renderTableData = () => {
    if (!tableData || tableData.data.length === 0) {
      return <div className="no-data">No data found</div>;
    }

    const columns = Object.keys(tableData.data[0]);
    const pkColumn = tableSchema.find(col => col.pk === 1);
    const canDelete = !!pkColumn; // Can only delete rows if there's a primary key

    return (
      <div className="table-container">
        <div className="table-header">
          <h3>{selectedTable} ({tableData.total} rows)</h3>
          <div className="table-actions">
            <button onClick={updateSelectedRows} className="button-warning">
              Update Rows
            </button>
            <button onClick={deleteSelectedRows} className="button-danger">
              Delete Rows (WHERE)
            </button>
            {canDelete && (
              <button 
                onClick={deleteSelectedRowsById} 
                className="button-danger"
                disabled={selectedRows.size === 0}
              >
                Delete Selected ({selectedRows.size})
              </button>
            )}
          </div>
        </div>
        
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                {canDelete && (
                  <th style={{ width: '40px' }}>
                    <input
                      type="checkbox"
                      checked={tableData.data.length > 0 && selectedRows.size === tableData.data.length}
                      onChange={toggleAllRows}
                      title="Select all rows"
                    />
                  </th>
                )}
                {columns.map(col => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableData.data.map((row, index) => (
                <tr key={index} className={selectedRows.has(index) ? 'selected-row' : ''}>
                  {canDelete && (
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedRows.has(index)}
                        onChange={() => toggleRowSelection(index)}
                      />
                    </td>
                  )}
                  {columns.map(col => (
                    <td key={col} title={String(row[col])} className={col.toLowerCase() === 'id' ? 'id-column' : ''}>
                      {String(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {tableData.totalPages > 1 && (
          <div className="pagination">
            <button 
              onClick={() => loadTableData(currentPage - 1)}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <span>Page {currentPage} of {tableData.totalPages}</span>
            <button 
              onClick={() => loadTableData(currentPage + 1)}
              disabled={currentPage === tableData.totalPages}
            >
              Next
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderQueryResult = () => {
    if (queryResult.length === 0) return null;

    const columns = Object.keys(queryResult[0]);

    return (
      <div className="query-result">
        <h4>Query Result ({queryResult.length} rows)</h4>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                {columns.map(col => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {queryResult.map((row, index) => (
                <tr key={index}>
                  {columns.map(col => (
                    <td key={col} title={String(row[col])} className={col.toLowerCase() === 'id' ? 'id-column' : ''}>
                      {String(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  if (!isWarningAccepted) {
    return (
      <div className="database-warning">
        <div className="warning-content">
          <h2>⚠️ Database Management</h2>
          <div className="warning-text">
            <p><strong>WARNING:</strong> Doing anything with this page can cause issues with Bob and your Git repositories and may require manual cleanup.</p>
            <ul>
              <li>Only use this page if you know what you're doing</li>
              <li>Always backup your data before making modifications</li>
              <li>Incorrect operations may corrupt your Bob database</li>
              <li>You may need to manually clean up Git repositories if something goes wrong</li>
            </ul>
            <p>This interface provides direct access to Bob's SQLite database for debugging and manual maintenance purposes.</p>
          </div>
          <div className="warning-actions">
            <button 
              onClick={() => setIsWarningAccepted(true)}
              className="button-danger"
            >
              I Understand the Risks - Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="database-manager">
      <div className="database-header">
        <h2>Database Management</h2>
        <button 
          onClick={() => navigate('/', { state: { fromDatabase: true } })}
          className="button-secondary"
        >
          Exit Database Manager
        </button>
      </div>

      {error && (
        <div className="error-message">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {success && (
        <div className="success-message">
          {success}
          <button onClick={() => setSuccess(null)}>×</button>
        </div>
      )}

      <div className="database-content">
        <div className="sidebar">
          <div className="sidebar-section">
            <h3>Tables</h3>
            {loading ? (
              <div className="loading-spinner">Loading...</div>
            ) : (
              <div className="table-list">
                {tables.map(table => (
                  <button
                    key={table}
                    onClick={() => setSelectedTable(table)}
                    className={`table-item ${selectedTable === table ? 'active' : ''}`}
                  >
                    {table}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedTable && tableSchema.length > 0 && (
            <div className="sidebar-section">
              <h4>Schema: {selectedTable}</h4>
              <div className="schema-info">
                {tableSchema.map(col => (
                  <div key={col.name} className="column-info">
                    <strong>{col.name}</strong>
                    <span className="column-type">{col.type}</span>
                    {col.pk ? <span className="primary-key">PK</span> : null}
                    {col.notnull ? <span className="not-null">NOT NULL</span> : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="main-content">
          {selectedTable ? (
            renderTableData()
          ) : (
            <div className="no-selection">Select a table to view its data</div>
          )}

          <div className="query-section">
            <h3>Execute SQL Query</h3>
            <p className="query-note">Only SELECT queries are allowed for safety</p>
            <div className="query-input">
              <textarea
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                placeholder="SELECT * FROM repositories LIMIT 10;"
                rows={4}
              />
              <button 
                onClick={executeQuery}
                disabled={loading || !sqlQuery.trim()}
                className="button-primary"
              >
                Execute Query
              </button>
            </div>
            {renderQueryResult()}
          </div>
        </div>
      </div>
    </div>
  );
}