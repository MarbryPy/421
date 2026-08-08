# Contexte actuel du projet

Le dépôt contient une application web statique de 421 multijoueur. `index.html` charge Firebase, `lobby.js` gère l'authentification anonyme, les salons et la présence, tandis que `game.js` contient les règles et les transitions de partie. `style.css` fournit l'interface mobile.

Firebase Realtime Database est la source de vérité. Toutes les mutations importantes utilisent des transactions et réessaient lorsqu'un client démarre avec un cache local vide. L'identifiant Firebase anonyme est conservé localement afin qu'une actualisation rattache le joueur à son salon.

Configuration active : projet `mon421-a1108`, base `mon421-a1108-default-rtdb` en `europe-west1`, application web `421web`, connexion anonyme activée.

À ne pas ajouter avant les vacances : comptes permanents, matchmaking, chat, chat vocal ou refonte importante.

