# Pływający panel wszystkich akcji grupowych

## Zatwierdzenie i cel

Użytkownik odrzucił rozciągnięty układ pierwszej implementacji i zażądał pełnego zestawu z pierwotnej listy. Zatwierdził „Pełny zakres pływającego panelu” w tej sesji. Ten dokument zastępuje ograniczenia zakresu i układu wcześniejszego projektu; zachowuje jego zasady zapisu statusu/typu, ponawiania i zamykania drzewa.

Panel ma być estetyczny i zwarty, umożliwiać pracę na grupie bez otwierania poszczególnych kart.

## Podejście

- Odrzucony: formularz na całą szerokość, z rozciąganymi polami i odległymi przyciskami.
- Wybrany przez użytkownika: pływający panel o szerokości zawartości, wyśrodkowany nad dołem tablicy, z ikonami prostych akcji, podpowiedziami i małymi formularzami otwieranymi nad panelem.
- Samo menu „Więcej” ograniczyłoby widoczność akcji; akcje pozostają widoczne w grupach.

## Układ i dostępność

Licznik i kontrolki zaznaczenia; krótkie pola Status i Typ z Zastosuj; grupy ikon operacji oddzielone subtelnymi separatorami. Cień, obramowanie i zaokrąglenie według tokenów SDK/aplikacji. Bez rozciągania kontrolek przez flex-grow.

Na wąskim ekranie grupy zawijają się. Panel nie powoduje poziomego przewijania; ostatnią kartę można przewinąć ponad nim. Formularze mieszczą się w panelu i viewportcie, z własnym przewijaniem gdy trzeba. Tooltipy dostępne również przy focus, ikony mają aria-label. Escape zamyka najpierw formularz, dopiero następny Escape czyści zaznaczenie. Aktualizacja danych nie niszczy focus.

## Pełny zakres

- Status i typ: dotychczasowy jawny zapis przez Apply, w tym opcja zamknięcia wszystkich potomków.
- Przenoszenie do kolumny: dotychczasowa semantyka przenoszenia, odrębna od surowego statusu.
- Etykiety: dodanie/usunięcie etykiety.
- Hierarchia: wspólny rodzic, odpięcie od rodzica.
- Zależności: dodanie wspólnego blokera, zachowanie istniejących zależności.
- Agenci: uruchomienie pracy z normalnymi ustawieniami i limitem równoległości; dodanie do kolejki.
- Archiwizacja i przywrócenie.
- Usuwanie z osobnym potwierdzeniem zakresu.
- Kopiowanie tytułów i odnośników.
- Zaznacz wszystkie po filtrach, także poza ekranem; wyczyść zaznaczenie.

Akcje niedostępne dla źródła pozostają widoczne z powodem. Nie wprowadzamy atrap ani przycisków sugerujących wykonanie niezaimplementowanej operacji.

## Decyzje implementacyjne i istniejące ograniczenia

Poniższe decyzje wynikają z kodu, nie są cytatami wcześniejszych uzgodnień:

- Etykiety dotyczą GitHuba; lokalny tracker nie ma ich formatu. Dodawanie/usuwanie zwykłej etykiety nie może zmieniać etykiet statusu i typu.
- Lokalne blokery dotyczą istniejących podzadań tego samego rodzica. Zakaz relacji między źródłami pozostaje. Nie zastępujemy pozostałych blokerów.
- Archiwizujemy tylko ukończone zadania, zgodnie z istniejącą semantyką. Przywracanie usuwa znacznik archiwum, nie otwiera zadania.
- Kopiowanie lokalnego odnośnika oznacza ścieżkę zadania, bez wymyślania adresu HTTP.
- W grupie z nieobsługiwanymi celami formularz podaje liczbę obsługiwanych i pomijanych wraz z powodami; użytkownik jawnie zatwierdza dostępny podzbiór.
- Operacje zapisu mają wyniki per zadanie, bez cofania udanych zapisów. Ponowienie dotyczy tylko błędów. Kopiowanie zachowuje zaznaczenie.
- Zmiana rodzica może zmienić lokalny identyfikator: aktualizujemy zaznaczenie, wyniki, archiwum, ustawienia kart i kolejność; serwis już aktualizuje sesje i kolejkę.
- Start/queue nie mogą ukrywać błędu przez toast i zwracać pozornego sukcesu. Ponowienie nie uruchamia drugiego agenta, również po niejednoznacznym timeout.
- Usuwanie korzysta z istniejących reguł źródła; formularz pokazuje zakres potomków i wymaga potwierdzenia. Nie zaznaczamy tej opcji automatycznie na podstawie opcji zamykania.

## Weryfikacja

Publiczne API na rzeczywistym lokalnym trackerze, symulowane gh, kontroler grupowych akcji, prawdziwe kontrolki SDK w przeglądarce. Testy obejmują częściowe błędy, zmianę ID, nieobsługiwane cele, niejednoznaczny start, potwierdzanie usuwania, dostępność klawiaturą i układ wąski/szeroki. Wynik trafia do istniejącego PR #38 i lokalnego Kanban TEST.
