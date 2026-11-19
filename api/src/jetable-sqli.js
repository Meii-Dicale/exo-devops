// FICHIER JETABLE (bonus étape 5) : injections SQL VOLONTAIRES pour comparer
// Semgrep et CodeQL. Jamais importé par l'application, jamais fusionné.
import express from 'express';
import pg from 'pg';

const pool = new pg.Pool();
export const router = express.Router();

// Variante 1, directe : la concaténation est dans l'appel à query().
router.get('/recherche', async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM tasks WHERE title = '" + req.query.q + "'",
  );
  res.json(result.rows);
});

// Variante 2, indirecte : la requête est construite dans une autre fonction.
function construireRequete(titre) {
  return `SELECT * FROM tasks WHERE title = '${titre}'`;
}

function executer(sql) {
  return pool.query(sql);
}

router.get('/recherche-indirecte', async (req, res) => {
  const result = await executer(construireRequete(req.query.q));
  res.json(result.rows);
});
