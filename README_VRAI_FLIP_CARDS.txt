Correctif VRAI recto/verso des cartes stages

Fichiers à remplacer :
- stage.html
- devenir-formateur.html
- admin.html
- api/admin-tools.js
- vp-card-prevenir-module.webp
- vp-card-self-pro.webp
- vp-card-formateur-reseau.webp

Comportement :
- La face avant affiche uniquement les informations principales : parcours, prix, nom du module, lieu, date.
- Au premier clic, la carte se retourne réellement en 3D avec rotateY.
- Le verso affiche le descriptif du module et les infos secondaires.
- Au second clic sur une carte stage, le stage est sélectionné et la réservation s'active.
- Au second clic sur une carte formateur, la page devenir-formateur s'ouvre sur la session.

Images :
- vp-card-prevenir-module.webp : visuel femme qui met la distance.
- vp-card-self-pro.webp : visuel situation tendue à l'accueil professionnel.
- vp-card-formateur-reseau.webp : visuel réseau de formateurs.

Important : après déploiement Vercel, faire Ctrl+F5 pour vider le cache navigateur.
