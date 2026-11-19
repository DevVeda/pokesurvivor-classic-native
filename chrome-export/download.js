// Extension button: downloads the save as a .json file ({ps:'save', save}, the same thing sent to the game).
(function () {
  if (location.hostname !== 'pokesurvivor.com') return alert('PokéSurvivor: open pokesurvivor.com and press the button again.');
  const save = psPick('Download');
  if (!save) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ ps: 'save', save })], { type: 'application/json' }));
  a.download = 'pokesurvivor-' + String(save.name || 'save').replace(/[^\w-]+/g, '_') + '-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
})();
