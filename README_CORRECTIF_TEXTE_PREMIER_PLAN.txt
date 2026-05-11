Correctif texte cards marketplace

Ce correctif règle la disparition du texte sur les cards.

Cause corrigée :
- le conteneur de texte utilisait une structure HTML fragile avec un <span> contenant des éléments bloc <h4> et <p> ; selon le navigateur, le DOM pouvait être réorganisé et le texte passait derrière ou sortait du conteneur overlay.

Correction appliquée :
- contenu de card composé uniquement d'éléments inline compatibles ;
- texte forcé au premier plan avec z-index élevé ;
- images conservées en fond pleine card ;
- mêmes noms d'images qu'avant pour remplacer correctement les fichiers existants :
  vp-card-prevenir-module.webp
  vp-card-self-pro.webp
  vp-card-formateur-reseau.webp

Après remplacement : redéployer sur Vercel puis faire Ctrl+F5.
