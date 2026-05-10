AUTH MOT DE PASSE + MOT DE PASSE OUBLIE - VITAL PROTECT

Fichiers inclus :
- admin-login.html
- formateur-login.html
- mot-de-passe-oublie.html
- nouveau-mot-de-passe.html
- README_AUTH_MOT_DE_PASSE.txt

Ce que fait cette version :
1. Les connexions admin et formateur utilisent email + mot de passe avec supabase.auth.signInWithPassword().
2. Les pages admin-login.html et formateur-login.html contiennent un lien "Mot de passe oublié ?".
3. La page mot-de-passe-oublie.html envoie un email de réinitialisation via supabase.auth.resetPasswordForEmail().
4. La page nouveau-mot-de-passe.html permet de définir un nouveau mot de passe via supabase.auth.updateUser().

IMPORTANT :
- La connexion normale ne déclenche plus d'email Supabase.
- Le mot de passe oublié déclenche quand même un email Supabase. Avec l'email par défaut Supabase, la limite peut rester à 2 emails/heure.
- Pour éviter cette limite sur les resets, il faudra un SMTP personnalisé plus tard.

A FAIRE DANS SUPABASE :
1. Authentication > Providers > Email
   - Vérifier que Email provider est activé.
   - Vérifier que la connexion par mot de passe est autorisée.

2. Authentication > URL Configuration
   Ajouter dans les Redirect URLs autorisées :
   - https://TON-DOMAINE.fr/nouveau-mot-de-passe.html
   - https://www.TON-DOMAINE.fr/nouveau-mot-de-passe.html
   - éventuellement l'URL Vercel de preview si tu testes dessus.

3. Authentication > Users
   Pour chaque admin/formateur :
   - le compte doit exister dans Auth Users ;
   - l'email doit être confirmé ;
   - l'email doit correspondre à public.admin_users pour un admin ;
   - l'email doit correspondre à public.trainers pour un formateur.

Premier mot de passe :
- Méthode simple : créer/modifier l'utilisateur dans Authentication > Users et définir un mot de passe temporaire.
- Méthode utilisateur : envoyer le lien depuis /mot-de-passe-oublie.html pour que la personne définisse elle-même son mot de passe.

Après remplacement des fichiers :
- Déployer sur Vercel.
- Tester /admin-login.html.
- Tester /formateur-login.html.
- Tester /mot-de-passe-oublie.html avec un seul email au début pour ne pas retomber dans la rate limit.
