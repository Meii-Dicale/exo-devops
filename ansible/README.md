# ansible/ : préparer la production (bonus étape 3)

`prepare-prod.yml` refait, de façon **idempotente**, les gestes manuels de l'étape 2 : dossier `~/taskflow-prod` et
sous-dossiers (droits restreints), copie de `compose.prod.yaml`, `.env.example`, des scripts et de la conf Nginx, `.env`
rendu depuis un modèle (`0600`), certificat auto-signé généré une seule fois. Il **prépare** ; le déploiement reste le
rôle de `deploy.sh` et du workflow Release.

Inspiré de la solution du formateur (`solution/ansible/`), adapté à notre dépôt (voir « Différences »).

```bash
cd ansible
ansible-playbook -i inventory.ini prepare-prod.yml --check --diff   # simulation
ansible-playbook -i inventory.ini prepare-prod.yml
ansible-playbook -i inventory.ini prepare-prod.yml                  # 2e passage : changed=0
```

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `prod_dir` | `~/taskflow-prod` | dossier de déploiement (`PROD_DIR` du runner) |
| `ghcr_owner` | `meii-dicale` | propriétaire des images, en minuscules |
| `app_env` | `production` | `production` ou `staging` |
| `http_port` / `https_port` / `front_port` | 80 / 443 / 8081 | ports (`.env.example` explique lesquels servent où) |
| `password_file` | `~/.config/taskflow/postgres-password` | mot de passe généré s'il n'y a pas encore de `.env` |

## Différences avec la solution

- **`FRONT_PORT` dans le `.env`, `.env.example` copié** : depuis le post-mortem, `deploy.sh` refuse un `.env` auquel il
  manque une clé de `.env.example`. Sans ces deux ajouts, le `.env` rendu par Ansible serait refusé.
- **Mot de passe repris du `.env` existant** : PostgreSQL n'utilise `POSTGRES_PASSWORD` qu'à la création du volume. Un
  nouveau mot de passe sur une base déjà initialisée = API qui ne se connecte plus. Le fichier `password_file` ne sert
  que sur une machine neuve.
- **Le `.env` n'est jamais affiché** : `diff: false` sur le template (sinon `--diff` imprime le mot de passe),
  `no_log` sur la lecture du `.env` et le choix du mot de passe.
- **Le handler ne recharge que le proxy de `prod_dir`** : `compose.prod.yaml` fixe `name: taskflow-prod`, donc un
  `docker compose exec proxy` lancé depuis n'importe quel dossier viserait le proxy de la vraie prod. Le handler
  cherche le conteneur par ses labels Compose (`service=proxy` et `working_dir=<prod_dir>`), puis lance
  `nginx -t && nginx -s reload` : une conf invalide fait échouer le handler, l'ancienne reste en service.
- **Pas de `chdir` pour le certificat** (`CERT_DIR` absolu) : la simulation fonctionne sur une machine neuve.

## Preuves (19/11/2026, ansible-core 2.22.0, sur un dossier de test, jamais sur `~/taskflow-prod`)

| Passage | Résultat |
| --- | --- |
| `--check --diff` sur un dossier vierge | `changed=7`, `failed=0`, rien créé dans `prod_dir` |
| 1er passage | `changed=6` ; handler du proxy sauté (aucun proxy lancé depuis ce dossier) |
| 2e passage | **`changed=0`** |
| `password_file` supprimé, 3e passage | `changed=0`, mot de passe repris du `.env`, `.env` identique |
| conf Nginx modifiée + faux proxy étiqueté pour ce dossier | `changed=2` ; faux proxy rechargé, vrai proxy de prod non |

- Le `.env` rendu passe le contrôle de clés de `deploy.sh` ; droits : `.env` et clé TLS en `0600`, dossiers en
  `0750` / `0700`.
- Le mot de passe généré n'apparaît dans aucune sortie (0 occurrence dans les 5 journaux).
- `ansible-lint --offline` : 0 erreur, 0 avertissement (profil `production`).

## Limites

- Même en `--check`, le lookup `password` **crée** `password_file` s'il n'y a pas de `.env` (il s'exécute sur le
  contrôleur, hors du mode simulation).
- Le playbook n'a pas été lancé sur `~/taskflow-prod` : il resserrerait les droits des fichiers déjà en place (0755 →
  0750) et réécrirait le `.env` au format du modèle (mêmes valeurs). À faire à deux, avec une copie du `.env`.
- En entreprise : inventaire de vrais serveurs (SSH), secrets dans `ansible-vault` ou un coffre, et un rôle réutilisable.
