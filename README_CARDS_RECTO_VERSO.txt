Correctif cards recto/verso

Fichiers modifiés :
- stage.html
- devenir-formateur.html
- admin.html
- api/admin-tools.js
- vp-card-prevenir-module.webp
- vp-card-self-pro.webp
- vp-card-formateur-reseau.webp

Modifs principales :
1. La face avant des cards affiche uniquement les infos de base : parcours, prix, nom du module, lieu, date.
2. La face arrière apparaît au survol/focus et affiche les infos secondaires : descriptif du module, horaire/durée, places, action.
3. Les images de cards restent les bonnes images fournies et gardent les mêmes noms de fichiers.
4. Dans l'admin, la description longue du catalogue module est clairement indiquée comme le texte utilisé au dos des cards publiques.
5. stage.html tente de lire la table public.training_modules pour utiliser long_description/short_description. Si la lecture publique est bloquée par RLS, la page garde un descriptif par défaut.

À vérifier dans Supabase :
- table training_modules : colonnes short_description et long_description présentes ;
- RLS SELECT public autorisé au moins sur les modules actifs/publics, si vous voulez que le descriptif admin s'affiche publiquement.
