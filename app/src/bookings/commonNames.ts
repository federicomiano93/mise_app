// The words offered under «Nome cliente» while a booking is typed (the owner's ask, 19 Nov 2026: «trova i nomi più diffusi
// nella provincia di Catania e basta»): common first names and common surnames of the province of Catania, most common first.
//
// ⚠️ WORDS, NOT PEOPLE. Two separate lists of words: no name is linked to a surname, no phone number, no address, nothing about
// any customer of the venue. They come from published rankings of the province's commonest surnames (local press, 2015–2026,
// built on registry and ISTAT figures) and of first names (the traditional names of the Catania area for adults, ISTAT's
// commonest names of babies born in Sicily for the young), put in a rough order by hand. ⚠️ NEVER fill them from a phone
// directory or any list of real people: the owner asked for that first and it was refused (GDPR: a directory may not be
// reused for another purpose, and its sites forbid copying).
//
// The order matters: the window shows the first five that match, so the commoner word comes first. A word with an accent or an
// apostrophe is written as people write it (Patanè, D'Agata); matching ignores both.

export const COMMON_FIRST_NAMES: readonly string[] = [
  'Giuseppe', 'Salvatore', 'Maria', 'Antonino', 'Giovanni', 'Francesco', 'Agata', 'Carmela', 'Rosario', 'Concetta',
  'Alfio', 'Sebastiano', 'Angela', 'Grazia', 'Giuseppa', 'Anna', 'Venera', 'Santo', 'Orazio', 'Vincenzo',
  'Rosaria', 'Carmelo', 'Mario', 'Domenico', 'Angelo', 'Antonio', 'Giuseppina', 'Lucia', 'Rita', 'Francesca',
  'Rosa', 'Nunzio', 'Gaetano', 'Filippo', 'Paolo', 'Pietro', 'Luigi', 'Michele', 'Alessandro', 'Andrea',
  'Marco', 'Luca', 'Giulia', 'Sofia', 'Leonardo', 'Gabriele', 'Lorenzo', 'Matteo', 'Aurora', 'Chiara',
  'Martina', 'Alessia', 'Federica', 'Valentina', 'Sara', 'Giorgia', 'Roberta', 'Roberto', 'Daniele', 'Davide',
  'Simone', 'Stefano', 'Fabio', 'Massimo', 'Claudio', 'Sergio', 'Emanuele', 'Ignazio', 'Placido', 'Mariano',
  'Nicola', 'Nicolò', 'Giorgio', 'Enzo', 'Enza', 'Vincenza', 'Antonella', 'Daniela', 'Patrizia', 'Laura',
  'Elena', 'Cristina', 'Carla', 'Marta', 'Silvia', 'Monica', 'Barbara', 'Simona', 'Teresa', 'Caterina',
  'Margherita', 'Santa', 'Sebastiana', 'Alfia', 'Nunzia', 'Nunziata', 'Carmen', 'Graziella', 'Mariagrazia', 'Agatino',
  'Giuliana', 'Giulio', 'Giusy', 'Ivana', 'Loredana', 'Manuela', 'Melania', 'Noemi', 'Alice', 'Emma',
  'Beatrice', 'Ginevra', 'Gioele', 'Mattia', 'Samuele', 'Tommaso', 'Riccardo', 'Christian', 'Diego', 'Edoardo',
  'Federico', 'Gianluca', 'Giacomo', 'Alberto', 'Alfredo', 'Benedetto', 'Calogero', 'Cristoforo', 'Emilio', 'Ettore',
  'Fortunato', 'Franco', 'Gianni', 'Gregorio', 'Ignazia', 'Lorena', 'Luisa', 'Marcello', 'Mirella', 'Nello',
  'Raffaele', 'Riccarda', 'Rocco', 'Ruggero', 'Saverio', 'Silvana', 'Tiziana', 'Ugo', 'Vito', 'Viviana',
];

export const COMMON_SURNAMES: readonly string[] = [
  'Russo', 'Giuffrida', 'Messina', 'Grasso', 'Caruso', 'Privitera', 'Rapisarda', 'Catania', 'Torrisi', 'Di Mauro',
  'Puglisi', 'Pappalardo', 'Barbagallo', 'Finocchiaro', 'Spampinato', 'Marletta', 'La Rosa', 'Lombardo', 'Nicolosi', 'Nicotra',
  'Leonardi', 'Platania', 'Scuderi', 'Musumeci', 'Costa', 'Distefano', 'Di Stefano', 'Greco', 'Castorina', 'Ferrara',
  'Sciuto', 'Pulvirenti', 'Patanè', 'Cristaldi', 'Coco', 'Indelicato', 'Zappalà', 'Bonaccorsi', 'Santonocito', 'Arcidiacono',
  'Vitale', 'Marino', 'Romeo', 'Rizzo', 'Pennisi', 'Fichera', 'Mangano', 'Motta', 'Trovato', 'Cavallaro',
  'Di Bella', 'D\'Agata', 'Strano', 'Sapienza', 'Cutuli', 'Leotta', 'Lo Faro', 'Calì', 'Amato', 'Gulisano',
  'Fazio', 'Parisi', 'Ferro', 'Gullotta', 'Mazzaglia', 'Maugeri', 'Sciacca', 'Zappia', 'Cantarella', 'Licciardello',
  'Mirabella', 'Sambataro', 'Scalia', 'Lo Presti', 'Fisichella', 'Longo', 'Bonanno', 'Bruno', 'Tomasello', 'Garozzo',
  'Lanzafame', 'Ragusa', 'Sorbello', 'Signorelli', 'Bonsignore', 'Carbonaro', 'Consoli', 'Condorelli', 'Pagano', 'Raciti',
  'Raneri', 'Rizza', 'Saitta', 'Sinatra', 'Tropea', 'Vasta', 'Zuccarello', 'Aiello', 'Arena',
  'Asero', 'Basile', 'Belfiore', 'Bellia', 'Calabrese', 'Calvagna', 'Campisi', 'Cannavò', 'Cardillo', 'Carnemolla',
  'Castro', 'Cicero', 'Conti', 'Corsaro', 'D\'Amico', 'D\'Urso', 'De Luca', 'Di Benedetto', 'Di Grazia', 'Di Prima',
  'Ferlito', 'Fiore', 'Fresta', 'Gangi', 'Garofalo', 'Gentile', 'Giardina', 'Grillo', 'Guarnera', 'Guglielmino',
  'Interlandi', 'La Spina', 'Lauria', 'Leone', 'Lo Giudice', 'Lucà', 'Lupo', 'Malfitana', 'Mancuso', 'Marchese',
  'Marano', 'Mazza', 'Milazzo', 'Mineo', 'Mollica', 'Muscolino', 'Nastasi', 'Oliveri', 'Palermo', 'Palumbo',
  'Pace', 'Papa', 'Pavone', 'Pellegrino', 'Petralia', 'Pistorio', 'Pizzo', 'Rapisardi', 'Reitano',
  'Riccioli', 'Rindone', 'Rossi', 'Ruggeri', 'Sanfilippo', 'Santangelo', 'Scaccianoce', 'Scandurra', 'Schillaci',
  'Scuto', 'Sgroi', 'Sidoti', 'Spina', 'Squillaci', 'Stissi', 'Tosto', 'Trefiletti', 'Valenti', 'Vecchio',
  'Ventura', 'Villari', 'Zito', 'Zuccaro',
];
