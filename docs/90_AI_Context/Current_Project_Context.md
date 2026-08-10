# Contexte actuel du projet

Le dépôt contient une application web statique de 421 multijoueur. `index.html` charge Firebase, `lobby.js` gère l'authentification anonyme, les salons et la présence, tandis que `game.js` contient les règles et les transitions de partie. `style.css` fournit l'interface mobile.

Firebase Realtime Database est la source de vérité. Toutes les mutations importantes utilisent des transactions et réessaient lorsqu'un client démarre avec un cache local vide. L'identifiant Firebase anonyme est conservé localement afin qu'une actualisation rattache le joueur à son salon.

Configuration active : projet `mon421-a1108`, base `mon421-a1108-default-rtdb` en `europe-west1`, application web `421web`, connexion anonyme activée.

L’interface vise exclusivement une utilisation mobile en mode portrait. Sa direction visuelle est celle d’une table de jeu : feutrine verte, dés ivoire, accents dorés, commandes tactiles larges et panneaux réduits au strict nécessaire. Le chargement affiche une courte animation de trois dés formant 421. Le jeu utilise une zone de garde et un plateau de lancer octogonal à bordure bois ; les dés se déplacent par glisser-déposer ou toucher. Le payout présente le gagnant et le perdant en duel compact avec le transfert animé entre eux, puis classe séparément les mains neutres ; l’action de manche suivante reste fixée en bas à droite. Sur ordinateur, l’application reste simplement centrée dans une largeur de téléphone ; aucune interface bureau spécifique n’est prévue.

À ne pas ajouter avant les vacances : comptes permanents, matchmaking, chat, chat vocal ou refonte importante.
