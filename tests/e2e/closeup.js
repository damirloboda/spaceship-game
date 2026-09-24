// Third-person close-up of the player's face for debug screenshots.
(() => { const g = window.__game; if (g.cameraMode !== 'third') g.toggleView(); g.player.tpCam.position.set(0, 0.2, -2.4); g.player.tpCam.rotation.set(0, Math.PI, 0); g.hud.bannerQueue.length = 0; g.keepThirdPersonAboveGround = () => {}; })()
