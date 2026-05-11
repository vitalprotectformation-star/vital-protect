Correctif cards marketplace Vital Protect

Fichiers à remplacer à la racine du projet :
- stage.html
- devenir-formateur.html
- vp-card-prevenir-module.webp
- vp-card-self-pro.webp
- vp-card-formateur-reseau.webp

Ce correctif ne touche pas aux données Supabase.
Il corrige surtout la mise en page des cards :
- images chargées par une vraie balise <img> ;
- card à hauteur maîtrisée ;
- texte replacé au début de la zone bleue ;
- suppression de l'effet énorme vide bleu avant le texte ;
- box-sizing corrigé pour éviter que padding + min-height allongent la card.

Après remplacement : redéployer sur Vercel puis faire Ctrl+F5.
