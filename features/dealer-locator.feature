@sanity @dealer
Feature: Dealer locator

  As someone looking for MICHELIN tires
  I want to find a dealer near me
  So that I can buy and fit tires locally

  Background:
    Given I am on the "dealer locator" page

  @dealer @smoke
  Scenario: The dealer locator page loads with its core elements
    Then the "dealer search container" should be visible
    And the "dealer search input" should be visible
    And the "map" should be visible
    And the "top cities list" should be visible
    And there should be no console errors

  @dealer @search
  Scenario: Searching a city returns dealer results
    When I search for the city "Atlanta"
    And I select the first autocomplete suggestion
    Then the dealer results should be visible
    And I should see more than 1 "dealer cards"
    And the URL should contain "atlanta"

  @dealer @results
  Scenario: Dealer cards show the information needed to choose a dealer
    When I click the first top city
    Then the dealer results should be visible
    And every dealer card should have a "title"
    And every dealer card should have a "address"

  @dealer @navigation
  Scenario: Opening a dealer shows its details page
    When I click the first top city
    And I open the first dealer
    Then the dealer details page should be visible
    And the "page heading" should be visible
