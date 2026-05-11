Correctif final cards marketplace

Problème corrigé :
- les images s'affichaient mais le texte était poussé trop bas avec un grand vide bleu.

Correction appliquée :
- les visuels complets ne sont plus utilisés comme fond pleine hauteur de carte ;
- de nouvelles images recadrées photo-only sont utilisées en haut de carte ;
- la zone bleue et le texte sont reconstruits proprement en CSS ;
- le contenu commence juste sous l'image, sans grand espace vide ;
- les noms des modules et formations formateur restent appliqués.

Fichiers à remplacer :
- stage.html
- devenir-formateur.html
- vp-card-prevenir-photo.webp
- vp-card-self-pro-photo.webp
- vp-card-formateur-photo.webp

Les trois images doivent être à la racine du projet, au même niveau que stage.html.
Après remplacement : redéployer sur Vercel puis faire Ctrl + F5.
