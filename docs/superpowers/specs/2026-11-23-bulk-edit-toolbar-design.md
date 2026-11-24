# Pasek edycji grupowej — zatwierdzony projekt

## Cel i zakres

Edytować status i typ wielu zaznaczonych kart bez otwierania każdej osobno.
Uzgodnione podczas grillowania Q1–Q20 i potwierdzone przez użytkownika.
Źródłowy ticket: `.scratch/pasek-narzedzi-na-dole-do-edycji-zaznaczonych-zadan-jako-gru/spec.md`
w głównym checkoutcie `/Users/kamilagents/projects/ICF-OpenChamber-Kanban-board`.

## Podejścia

- Natychmiastowy zapis albo formularz z Zastosuj: wybrano formularz, aby ustawić oba pola przed zapisem.
- Pasek pływający albo dolny z rezerwacją miejsca: wybrano dolny, aby nie zasłaniać kart.
- Zamykanie zaznaczonych albo opcjonalne całe drzewo: wybrano opcję całego drzewa, domyślnie włączoną.
- Wykonanie: istniejące API pojedynczego zadania i nowy koordynator operacji grupowej z wynikami per zadanie/pole. To decyzja implementacyjna; istniejący mechanizm przenoszenia grup nie zwraca błędów wymaganych do ponawiania.

## Interakcja

- Przyklejony do dołu tablicy pasek, z miejscem w układzie i zawijaniem kontrolek w wąskim panelu.
- Widoczny od jednej Marked card; zwykła Selected card nie wystarcza.
- Licznik, Zaznacz wszystkie, Wyczyść, Status, Typ, Zastosuj.
- Zaznacz wszystkie: wszystkie karty po filtrach, we wszystkich kolumnach, także poza viewportem.
- Oba pola zaczynają jako Bez zmian. Zapis tylko wybranych pól; bez zmian przycisk nieaktywny.
- Statusy z TASK_STATES; typy z istniejącego wyboru typów. Bez nowej operacji usuwania typu.
- Niewysłane wartości zostają po zmianie grupy, znikają po wyczyszczeniu całej grupy.
- Sukces czyści zaznaczenie i chowa pasek. Błąd zachowuje nieudane zadania i ustawienia, bez rollbacku.
- W czasie zapisu: postęp, blokada pól, zaznaczenia, filtrów i ponownego zapisu.
- Wcześniejszy zapis zaznaczonego zadania blokuje Zastosuj z wyjaśnieniem, bez automatycznego uruchomienia po odblokowaniu.
- Nieudane zadania ukryte przez filtry zostają do ponowienia z wyraźną liczbą ukrytych elementów.

## Wykonanie

- Najpierw typ, potem status dla danego zadania; ponowienie pomija zapisane wartości.
- Przy done opcja zamknięcia podzadań domyślnie włączona, z liczbą dodatkowych zadań przed zapisem.
- Wszystkie poziomy drzewa, bez duplikatów. Typ tylko pierwotnie zaznaczonym zadaniom.
- Zamykanie od liści. Błąd potomka blokuje zamknięcie rodzica, nie blokuje innych gałęzi.
- Nieudani potomkowie trafiają do ponowienia nawet jeśli początkowo nie byli zaznaczeni; nie stają się przez to odbiorcami zmiany typu.
- Zmiana statusu zawsze zachowuje sesje i kolejkę, również done i wontfix; nie zatrzymuje agentów.
- Zadania lokalne i GitHub mogą być w jednej grupie.

## Testy i ograniczenia

Zatwierdzone granice: publiczna obsługa zaznaczenia/paska; wykonanie operacji grupowej; API usługi z rzeczywistym lokalnym trackerem. Bez testów prywatnych funkcji, pikselowych snapshotów i połączeń z prawdziwym GitHubem.

Nie rozszerzamy zakresu o etykiety, hierarchię, zależności, start agentów, archiwizację, usuwanie czy kopiowanie.
Nie zmieniamy semantyki istniejącego pojedynczego edytora ani przeciągania.
Szczegóły kodu, copy zgodne z angielskim interfejsem i style zgodne z tokenami aplikacji pozostają decyzjami implementacyjnymi.
