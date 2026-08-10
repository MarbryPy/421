# 421 entre amis

Jeu de 421 multijoueur pour navigateur, pensé pour être ouvert sur plusieurs téléphones sans créer de compte.

## Fonctionnalités

- création et partage d'un salon par code à 5 caractères ;
- 2 à 8 joueurs, état prêt et démarrage par l'hôte ;
- tours, lancers, dés gardés, manches, élimination et victoire synchronisés ;
- reconnexion après actualisation et présence en ligne ;
- transfert de l'hôte lorsqu'il quitte le salon ;
- nouvelle partie depuis l'écran de victoire ;
- interface adaptée aux petits écrans.

## Firebase

L'application utilise le projet `mon421-a1108`, Firebase Authentication en mode anonyme et Realtime Database en région `europe-west1`.

Avant une mise en ligne publique, publier les règles fournies :

```sh
npx firebase-tools deploy --only database --project mon421-a1108
```

Les règles autorisent la lecture d'un salon aux utilisateurs authentifiés. La création, l'entrée dans un salon en attente et les écritures des membres sont validées côté base. Le modèle reste adapté à un jeu entre amis : un membre du salon peut modifier l'état complet de la partie depuis son navigateur.

## Vérification locale

Servir le dossier avec un serveur HTTP local, puis ouvrir l'adresse sur deux navigateurs ou profils distincts. Les règles de jeu peuvent être testées sans dépendance :

```sh
node tests/game.test.js
```

