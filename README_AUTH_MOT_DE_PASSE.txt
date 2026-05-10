PASSAGE EN CONNEXION EMAIL + MOT DE PASSE
========================================

Fichiers modifiés :
- admin-login.html
- formateur-login.html

Ce qui change :
- Le bouton n'envoie plus de magic link.
- La connexion utilise Supabase Auth avec signInWithPassword({ email, password }).
- Les limites d'envoi d'emails Supabase ne bloquent plus les connexions quotidiennes.

À faire dans Supabase avant test :
1. Aller dans Authentication > Users.
2. Créer ou modifier l'utilisateur admin avec :
   - le même email que dans la table public.admin_users ;
   - un mot de passe ;
   - email confirmé / auto-confirmé.
3. Pour chaque formateur :
   - créer un utilisateur Auth avec le même email que dans la table public.trainers ;
   - définir un mot de passe ;
   - confirmer l'email / auto-confirmer l'utilisateur.

Important :
- Si un utilisateur existe déjà mais n'a pas de mot de passe, il faudra lui définir un mot de passe dans Supabase.
- Le reset de mot de passe par email utilise encore les emails Supabase. Sans SMTP personnalisé, il reste limité.
- Les fichiers auth-callback.html et formateur-callback.html peuvent rester dans le projet, mais ils ne sont plus utilisés par cette connexion par mot de passe.

Test rapide :
- /admin-login.html : email admin + mot de passe -> /admin.html
- /formateur-login.html : email formateur + mot de passe -> /espace-formateur.html
