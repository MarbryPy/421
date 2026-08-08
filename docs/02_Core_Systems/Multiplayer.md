# Système multijoueur

## Modèle de salon

Chaque salon se trouve sous `rooms/{CODE}` et utilise `schemaVersion: 2`. Il contient l'hôte, les réglages, les joueurs, leur ordre, l'état de la partie, le tour courant, les mains de la manche et un journal court.

Le code de salon utilise cinq caractères non ambigus. Un salon accueille de 2 à 8 joueurs. L'hôte démarre lorsque tous les joueurs sont prêts.

## Identité et présence

Firebase Authentication crée une identité anonyme persistante par navigateur. Cette identité sert de clé joueur et permet de restaurer une session après actualisation. `onDisconnect` marque le joueur hors ligne ; une déconnexion ne le retire pas automatiquement de la partie.

## Concurrence

La création, l'entrée, l'état prêt, le démarrage, les tours, le départ d'un joueur et la remise à zéro utilisent des transactions Realtime Database. Les transactions sont amorcées avec une lecture confirmée lorsque le SDK présente d'abord un cache vide, puis réessayées jusqu'à trois fois.

Les lancers contiennent un `nonce` de tour pour empêcher un ancien clic ou une réponse tardive d'écraser le tour suivant.

## Sécurité

Les règles dans `database.rules.json` exigent une authentification, un code valide et un schéma de salon cohérent. Un nouveau joueur peut seulement entrer dans un salon encore au lobby. Une fois membre, son client peut écrire l'état complet du salon : ce choix privilégie la simplicité d'un jeu privé entre amis et ne protège pas contre un participant malveillant.

Les règles doivent être publiées séparément du site statique.

