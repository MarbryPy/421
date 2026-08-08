# Système multijoueur

## Modèle de salon

Chaque salon se trouve sous `rooms/{CODE}` et utilise `schemaVersion: 2`. Il contient l'hôte, les réglages, les joueurs, leur ordre, l'état de la partie, le tour courant, les mains de la manche, le résultat de la dernière manche et un journal court.

Le code de salon utilise cinq caractères non ambigus. Un salon accueille de 2 à 8 joueurs. L'hôte démarre lorsque tous les joueurs sont prêts.

## Identité et présence

Firebase Authentication crée une identité anonyme persistante par navigateur. Cette identité sert de clé joueur et permet de restaurer une session après actualisation. `onDisconnect` marque le joueur hors ligne ; une déconnexion ne le retire pas automatiquement de la partie.

## Concurrence

La création, l'entrée, l'état prêt, le démarrage, les tours, le départ d'un joueur et la remise à zéro utilisent des transactions Realtime Database. Les transactions sont amorcées avec une lecture confirmée lorsque le SDK présente d'abord un cache vide, puis réessayées jusqu'à trois fois.

Les lancers contiennent un `nonce` de tour pour empêcher un ancien clic ou une réponse tardive d'écraser le tour suivant.

## Déroulement d’un tour et d’une manche

Un joueur dispose de trois lancers. Après le premier lancer, il peut déplacer chaque dé entre la zone à relancer et la zone à garder, par glisser-déposer ou par toucher. Le troisième lancer valide automatiquement la main.

Quand toutes les mains sont jouées, le salon passe à l’état `payout`. `roundResult` conserve les mains classées, les gagnants, les perdants et chaque transfert de jetons. Chaque meilleure main donne au maximum sa pénalité à la main la plus faible. Le perdant de la manche peut donc dépasser la mise de départ. En cas d’égalité entre plusieurs perdants, les jetons reçus sont répartis sans fraction et de manière déterministe. Une égalité complète ne déplace aucun jeton.

Un joueur qui atteint zéro jeton a réussi à sortir de la partie. Quand il ne reste plus qu’un joueur avec des jetons, celui-ci est enregistré comme `loserId` et perd la partie.

Le récapitulatif reste synchronisé chez tous les joueurs. L’hôte démarre ensuite la manche suivante, ou affiche le vainqueur lorsque la partie est terminée.

## Sécurité

Les règles dans `database.rules.json` exigent une authentification, un code valide et un schéma de salon cohérent. Elles acceptent les états `lobby`, `playing`, `payout` et `finished`, ainsi que des scores pouvant monter jusqu’à 1000 jetons. Un nouveau joueur peut seulement entrer dans un salon encore au lobby. Une fois membre, son client peut écrire l'état complet du salon : ce choix privilégie la simplicité d'un jeu privé entre amis et ne protège pas contre un participant malveillant.

Les règles doivent être publiées séparément du site statique.
